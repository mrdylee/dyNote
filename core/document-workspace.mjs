import {renamedTreePath} from './file-tree.mjs';

export const DOCUMENT_DRAG = 'application/x-dynote-document';
export const TAB_DRAG = 'application/x-dynote-tab';

export const documentKey = (vaultId, path) => vaultId && path ? `${vaultId}:${path}` : null;

export function documentRef(key, vaultId = null) {
  if (/^[a-f0-9]{16}:/.test(key ?? '')) return { vaultId: key.slice(0, 16), path: key.slice(17) };
  return { vaultId, path: key ?? null };
}

export function spaceLabel(space) {
  const kind = space.purpose === 'personal' ? '개인 노트' : space.purpose === 'team' ? '팀 공유 노트' : '보관함';
  return `${kind} · ${space.name}`;
}

// Only restore documents still present in the connected vaults.
export function documentSession(saved, vaults) {
  if (!Array.isArray(saved?.tabs) || !Array.isArray(saved.paths)) return null;
  const available = new Set(Object.values(vaults).flatMap(vault =>
    [...vault.notes, ...(vault.documents ?? [])].map(file => documentKey(vault.id, file.path))));
  const tabs = [...new Set(saved.tabs.filter(key => available.has(key)))];
  if (!tabs.length) return null;
  const paths = [...new Set(saved.paths.filter(key => tabs.includes(key)))].slice(0, 3);
  if (!paths.length) paths.push(tabs.at(-1));
  const active = paths.includes(saved.active) ? saved.active : paths[0];
  const modes = {}, widths = {};
  for (const key of tabs) {
    const mode = saved.modes?.[key], width = saved.widths?.[key];
    if (['live','read','split','edit','mindmap'].includes(mode)) modes[key] = mode;
    if (Number.isFinite(width) && width >= 180 && width <= 900) widths[key] = width;
  }
  return { tabs, paths, active, modes, widths, viewingDocuments: saved.viewingDocuments === true };
}

export function workspaceAction(value, action, initialMarkdownMode = () => 'live') {
  const state = value ?? {paths:[], active:null, modes:{}};
  const {path} = action;
  if (action.type === 'restore') {
    const {paths, active, modes} = action.session;
    return {paths, active, modes};
  }
  if (action.type === 'reset') return {paths:path ? [path] : [], active:path ?? null, modes:path&&/\.md$/i.test(path)?{[path]:initialMarkdownMode(path)}:{}};
  if (action.type === 'mode') return {...state, modes:{...state.modes,[path ?? state.active]:action.mode}};
  if (action.type === 'rename') {
    const { [path]: mode, ...modes } = state.modes;
    if (mode) modes[action.to] = mode;
    const paths = [...new Set(state.paths.map(key => key === path ? action.to : key))];
    return {...state, paths, active:state.active === path ? action.to : state.active, modes};
  }
  if (action.type === 'rename-tree') {
    const moved = key => {
      const ref = documentRef(key);
      return ref.vaultId === action.vaultId ? documentKey(ref.vaultId, renamedTreePath(ref.path, action.from, action.to)) : key;
    };
    const modes = {...state.modes};
    for (const [key, mode] of Object.entries(state.modes)) {
      const next = moved(key);
      if (next === key) continue;
      delete modes[key];
      modes[next] = mode;
    }
    return {...state, paths:[...new Set(state.paths.map(moved))], active:moved(state.active), modes};
  }
  if (action.type === 'remove-tree') {
    const keep = key => {
      const ref = documentRef(key);
      return ref.vaultId !== action.vaultId || !(ref.path === path || (action.folder && ref.path.startsWith(path + '/')));
    };
    const paths = state.paths.filter(keep);
    return {...state, paths, active:keep(state.active) ? state.active : paths.at(-1) ?? null,
      modes:Object.fromEntries(Object.entries(state.modes).filter(([key]) => keep(key)))};
  }
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
  const modes={...state.modes,[path]:state.modes[path]??(/\.md$/i.test(path)?initialMarkdownMode(path):'read')};
  if (action.type === 'add') {
    if (state.paths.length >= 3) return state;
    const paths = [...state.paths], index = Math.max(0, paths.indexOf(action.anchor ?? state.active));
    paths.splice(action.side === 'left' ? index : index + 1, 0, path);
    return {...state, paths, active:path, modes};
  }
  return {...state, paths:state.paths.length ? state.paths.map(p => p === state.active ? path : p) : [path], active:path, modes};
}
