export const DOCUMENT_DRAG = 'application/x-dynote-document';
export function workspaceAction(value, action) {
  const state = value ?? {paths:[], active:null, modes:{}};
  const {path} = action;
  if (action.type === 'reset') return {paths:path ? [path] : [], active:path ?? null, modes:{}};
  if (action.type === 'mode') return {...state, modes:{...state.modes,[state.active]:action.mode}};
  if (action.type === 'reconcile' || action.type === 'close') {
    const paths = state.paths.filter(p => action.type === 'close' ? p !== path : action.paths.includes(p));
    return {...state, paths, active:paths.includes(state.active) ? state.active : paths.at(-1) ?? null};
  }
  if (!['open','add'].includes(action.type)) return state;
  if (!path) return {...state, paths:[], active:null};
  if (action.type === 'add' && (!/\.md$/i.test(path) || !['left','right'].includes(action.side))) return state;
  if (state.paths.includes(path)) return {...state, active:path};
  if (action.type === 'add') {
    if (state.paths.length >= 3) return state;
    const paths = [...state.paths], index = Math.max(0, paths.indexOf(action.anchor ?? state.active));
    paths.splice(action.side === 'left' ? index : index + 1, 0, path);
    return {...state, paths, active:path};
  }
  return {...state, paths:state.paths.length ? state.paths.map(p => p === state.active ? path : p) : [path], active:path};
}
