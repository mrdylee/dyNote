const paths = value => [...new Set(Array.isArray(value) ? value.filter(p => typeof p === 'string' && p.length > 0) : [])];
export function normalizeNavigation(value) {
  return { recent: paths(value?.recent).slice(0,50), bookmarks: paths(value?.bookmarks) };
}
export function navigationAction(value, action) {
  const state = normalizeNavigation(value);
  if (action.type === 'visit') state.recent = [action.path, ...state.recent.filter(p => p !== action.path)].slice(0,50);
  if (action.type === 'bookmark') state.bookmarks = state.bookmarks.includes(action.path) ? state.bookmarks.filter(p => p !== action.path) : [...state.bookmarks, action.path];
  if (action.type === 'rename') for (const key of ['recent','bookmarks']) state[key] = paths(state[key].map(p => p === action.from ? action.to : p));
  if (action.type === 'remove') for (const key of ['recent','bookmarks']) state[key] = state[key].filter(p => p !== action.path);
  return state;
}
export function reconcileNavigation(value, existing) {
  const state = normalizeNavigation(value), present = new Set(existing);
  return { recent: state.recent.filter(p => present.has(p)), bookmarks: state.bookmarks.filter(p => present.has(p)) };
}
