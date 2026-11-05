export const DOCUMENT_DRAG = 'application/x-dynote-document';

export const documentKey = (vaultId, path) => vaultId && path ? `${vaultId}:${path}` : null;

export function documentRef(key, vaultId = null) {
  if (/^[a-f0-9]{16}:/.test(key ?? '')) return { vaultId: key.slice(0, 16), path: key.slice(17) };
  return { vaultId, path: key ?? null };
}

export function spaceLabel(space) {
  const kind = space.purpose === 'personal' ? '개인 노트' : space.purpose === 'team' ? '팀 공유 노트' : '보관함';
  return `${kind} · ${space.name}`;
}

export function workspaceAction(value, action) {
  const state = value ?? {paths:[], active:null, modes:{}};
  const {path} = action;
  if (action.type === 'reset') return {paths:path ? [path] : [], active:path ?? null, modes:path&&/\.md$/i.test(path)?{[path]:'live'}:{}};
  if (action.type === 'mode') return {...state, modes:{...state.modes,[path ?? state.active]:action.mode}};
  if (action.type === 'reconcile' || action.type === 'close' || action.type === 'reconcile-vault') {
    const paths = state.paths.filter(p => {
      if (action.type === 'close') return p !== path;
      if (action.type === 'reconcile-vault' && documentRef(p).vaultId !== action.vaultId) return true;
      return action.paths.includes(p);
    });
    return {...state, paths, active:paths.includes(state.active) ? state.active : paths.at(-1) ?? null};
  }
  if (!['open','add'].includes(action.type)) return state;
  if (!path) return {...state, paths:[], active:null};
  if (action.type === 'add' && (!/\.md$/i.test(path) || !['left','right'].includes(action.side))) return state;
  if (state.paths.includes(path)) return {...state, active:path};
  const modes={...state.modes,[path]:state.modes[path]??(/\.md$/i.test(path)?'live':'read')};
  if (action.type === 'add') {
    if (state.paths.length >= 3) return state;
    const paths = [...state.paths], index = Math.max(0, paths.indexOf(action.anchor ?? state.active));
    paths.splice(action.side === 'left' ? index : index + 1, 0, path);
    return {...state, paths, active:path, modes};
  }
  return {...state, paths:state.paths.length ? state.paths.map(p => p === state.active ? path : p) : [path], active:path, modes};
}
