const files = new WeakMap();

export const fileLocationRef = key => node => {
  if (node) files.set(node, key);
};

export function fileForElement(node) {
  for (; node; node = node.parentElement) {
    if (files.has(node)) return files.get(node) ?? null;
  }
  return null;
}
