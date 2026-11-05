export const STICKY_SHORTCUT = "Ctrl+Shift+M";
export const STICKY_COLORS = ["cream", "mint", "lavender", "sky", "peach"];

const cardSize = { width: 320, height: 220 };
const margin = 14;
const step = 32;

export function fitStickyBounds(bounds, area) {
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
    width,
    height,
  };
}

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function nextStickyPlacement(area, openCards, previous) {
  const next = (STICKY_COLORS.indexOf(previous?.color) + 1) % STICKY_COLORS.length;
  const palette = [...STICKY_COLORS.slice(next), ...STICKY_COLORS.slice(0, next)];
  const color = palette.find(color => !openCards.some(card => card.color === color)) ?? palette[0];
  const start = fitStickyBounds({
    ...cardSize,
    x: area.x + area.width - cardSize.width - margin,
    y: area.y + margin,
  }, area);
  const taken = bounds => openCards.some(card => overlaps(bounds, card.bounds));
  const usedPosition = bounds => [previous, ...openCards].some(card =>
    card?.bounds.x === bounds.x && card.bounds.y === bounds.y);

  for (let y = start.y; y <= area.y + area.height - start.height; y += start.height + margin) {
    for (let x = start.x; x >= area.x; x -= start.width + margin) {
      const bounds = { ...start, x, y };
      if (!taken(bounds) && !usedPosition(bounds)) return { color, bounds };
    }
  }

  const room = Math.max(area.width - start.width, area.height - start.height);
  for (let offset = step; offset < room + step; offset += step) {
    const bounds = fitStickyBounds({ ...start, x: start.x - offset, y: start.y + offset }, area);
    if (!usedPosition(bounds)) return { color, bounds };
  }
  return { color, bounds: start };
}
