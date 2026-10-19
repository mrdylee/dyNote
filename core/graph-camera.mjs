export const worldToScreen = (p, c) => ({ x: p.x * c.zoom + c.x, y: p.y * c.zoom + c.y });
export const screenToWorld = (p, c) => ({ x: (p.x - c.x) / c.zoom, y: (p.y - c.y) / c.zoom });
export function zoomAt(camera, point, factor) {
  const world = screenToWorld(point, camera);
  const zoom = Math.min(6, Math.max(0.015, camera.zoom * factor));
  return { x: point.x - world.x * zoom, y: point.y - world.y * zoom, zoom };
}
export function segmentVisible(x1, y1, x2, y2, width, height) {
  let low = 0, high = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) low = Math.max(low, r); else high = Math.min(high, r);
    return low <= high;
  };
  return clip(-dx, x1) && clip(dx, width - x1) && clip(-dy, y1) && clip(dy, height - y1);
}
