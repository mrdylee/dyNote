const keyFor = documentKey => `dynote.splitReading.${documentKey}`;

export function readSplitPosition(documentKey) {
  try {
    const saved = JSON.parse(localStorage.getItem(keyFor(documentKey)));
    const anchor = saved?.anchor;
    if (typeof saved?.preview !== "boolean" || !anchor) return null;
    if (anchor.start === true) return saved;
    if (Number.isSafeInteger(anchor.line) && anchor.line >= 0 && Number.isFinite(anchor.offset) &&
        Number.isFinite(anchor.fraction) && anchor.fraction >= 0 && anchor.fraction <= 1) return saved;
  } catch { /* A missing or unreadable preference uses the default view. */ }
  return null;
}

export function writeSplitPosition(documentKey, position) {
  try {
    if (position) localStorage.setItem(keyFor(documentKey), JSON.stringify(position));
    else localStorage.removeItem(keyFor(documentKey));
  } catch { /* The open tab still has its in-memory position. */ }
}
