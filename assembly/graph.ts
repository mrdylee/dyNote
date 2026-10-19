// Independent uniform-quadtree Barnes-Hut approximation. No source-app code.
const LEVELS: i32 = 7;
const SIDE: i32 = 1 << LEVELS;
const LEAVES: i32 = SIDE * SIDE;
const FIRST: i32 = (LEAVES - 1) / 3;
const CELLS: i32 = FIRST + LEAVES;
let count: i32 = 0;
let edgeCount: i32 = 0;
let xy = new Float32Array(0), velocity = new Float32Array(0);
let radii = new Float32Array(0), degree = new Float32Array(0);
let links = new Uint32Array(0), pinned = new Uint8Array(0), next = new Int32Array(0);
const mass = new Float32Array(CELLS), mx = new Float32Array(CELLS), my = new Float32Array(CELLS);
const cx = new Float32Array(CELLS), cy = new Float32Array(CELLS), width = new Float32Array(CELLS);
const head = new Int32Array(LEAVES), stack = new Int32Array(64);

export function init(n: i32, e: i32): void {
  count = n; edgeCount = e;
  xy = new Float32Array(n * 2); velocity = new Float32Array(n * 2);
  radii = new Float32Array(n); degree = new Float32Array(n);
  pinned = new Uint8Array(n); next = new Int32Array(n); links = new Uint32Array(e * 2);
  cx[0] = cy[0] = 0.5; width[0] = 1;
  for (let i = 0; i < FIRST; i++) {
    const w = unchecked(width[i]) * 0.5;
    for (let j = 0; j < 4; j++) {
      const c = i * 4 + j + 1;
      unchecked(width[c] = w);
      unchecked(cx[c] = cx[i] + ((j & 1) != 0 ? w * 0.5 : -w * 0.5));
      unchecked(cy[c] = cy[i] + ((j & 2) != 0 ? w * 0.5 : -w * 0.5));
    }
  }
}
export function positionsPtr(): usize { return xy.dataStart; }
export function linksPtr(): usize { return links.dataStart; }
export function radiiPtr(): usize { return radii.dataStart; }
export function prepare(): void {
  for (let i = 0; i < edgeCount * 2; i++) unchecked(degree[links[i]]++);
  // Deterministic tiny offsets let coincident points separate without random state.
  for (let i = 0; i < count; i++) {
    unchecked(xy[i * 2] += Mathf.cos(<f32>i * 2.399963) * 0.01);
    unchecked(xy[i * 2 + 1] += Mathf.sin(<f32>i * 2.399963) * 0.01);
  }
}
export function pin(i: i32, x: f32, y: f32): void {
  unchecked(pinned[i] = 1); unchecked(xy[i * 2] = x); unchecked(xy[i * 2 + 1] = y);
  unchecked(velocity[i * 2] = 0); unchecked(velocity[i * 2 + 1] = 0);
}
export function unpin(i: i32): void { unchecked(pinned[i] = 0); }
@inline function spread(v: i32): i32 {
  v = (v | (v << 4)) & 0x0f0f;
  v = (v | (v << 2)) & 0x3333;
  return (v | (v << 1)) & 0x5555;
}
export function step(alpha: f32, center: f32, repel: f32, spring: f32, distance: f32, damping: f32): void {
  if (count == 0) return;
  let minX: f32 = Infinity, minY: f32 = Infinity, maxX: f32 = -Infinity, maxY: f32 = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = unchecked(xy[2 * i]), y = unchecked(xy[2 * i + 1]);
    minX = Mathf.min(minX, x); maxX = Mathf.max(maxX, x);
    minY = Mathf.min(minY, y); maxY = Mathf.max(maxY, y);
    unchecked(velocity[2 * i] -= x * center * alpha * 0.01);
    unchecked(velocity[2 * i + 1] -= y * center * alpha * 0.01);
  }
  for (let i = 0; i < edgeCount; i++) {
    const a = <i32>unchecked(links[2 * i]), b = <i32>unchecked(links[2 * i + 1]);
    const dx = unchecked(xy[b * 2] - xy[a * 2]), dy = unchecked(xy[b * 2 + 1] - xy[a * 2 + 1]);
    const length = Mathf.max(0.01, Mathf.sqrt(dx * dx + dy * dy));
    const force = (length - distance) / length * spring * alpha / Mathf.max(1, Mathf.min(unchecked(degree[a]), unchecked(degree[b])));
    const bias = unchecked(degree[a]) / Mathf.max(1, unchecked(degree[a] + degree[b]));
    unchecked(velocity[2 * a] += dx * force * (1 - bias));
    unchecked(velocity[2 * a + 1] += dy * force * (1 - bias));
    unchecked(velocity[2 * b] -= dx * force * bias);
    unchecked(velocity[2 * b + 1] -= dy * force * bias);
  }
  mass.fill(0); mx.fill(0); my.fill(0); head.fill(-1);
  const span = Mathf.max(1, Mathf.max(maxX - minX, maxY - minY) + 1);
  for (let i = 0; i < count; i++) {
    const x = unchecked(xy[2 * i]), y = unchecked(xy[2 * i + 1]);
    const gx = <i32>((x - minX) / span * <f32>SIDE), gy = <i32>((y - minY) / span * <f32>SIDE);
    const leaf = spread(gx) | (spread(gy) << 1), cell = FIRST + leaf;
    unchecked(next[i] = head[leaf]); unchecked(head[leaf] = i);
    unchecked(mass[cell]++); unchecked(mx[cell] += x); unchecked(my[cell] += y);
  }
  for (let i = CELLS - 1; i > 0; i--) {
    const parent = (i - 1) / 4;
    unchecked(mass[parent] += mass[i]); unchecked(mx[parent] += mx[i]); unchecked(my[parent] += my[i]);
  }
  for (let i = 0; i < CELLS; i++) {
    const m = unchecked(mass[i]);
    if (m > 0) { unchecked(mx[i] /= m); unchecked(my[i] /= m); }
  }
  for (let i = 0; i < count; i++) {
    if (unchecked(pinned[i]) != 0) continue;
    const x = unchecked(xy[2 * i]), y = unchecked(xy[2 * i + 1]), r = unchecked(radii[i]);
    let fx: f32 = 0, fy: f32 = 0, top = 1;
    unchecked(stack[0] = 0);
    while (top > 0) {
      const c = unchecked(stack[--top]), m = unchecked(mass[c]);
      if (m == 0) continue;
      const dx = x - unchecked(mx[c]), dy = y - unchecked(my[c]);
      const d2 = dx * dx + dy * dy, size = unchecked(width[c]) * span;
      const contains = Mathf.abs(x - (minX + unchecked(cx[c]) * span)) <= size * 0.5 && Mathf.abs(y - (minY + unchecked(cy[c]) * span)) <= size * 0.5;
      if (!contains && size * size < 0.81 * d2 && d2 > (r + 24) * (r + 24)) {
        const force = repel * alpha * m / Mathf.max(d2, 1);
        fx += dx * force; fy += dy * force;
      } else if (c >= FIRST) {
        let j = unchecked(head[c - FIRST]);
        while (j >= 0) {
          if (j != i) {
            let px = x - unchecked(xy[2 * j]), py = y - unchecked(xy[2 * j + 1]);
            if (px * px + py * py < 0.000001) { px = i < j ? -0.01 : 0.01; py = 0.01; }
            const d = Mathf.sqrt(px * px + py * py), radius = r + unchecked(radii[j]);
            let force = repel * alpha / Mathf.max(d * d, 1);
            if (d < radius) force += (radius - d) / d * 0.25;
            fx += px * force; fy += py * force;
          }
          j = unchecked(next[j]);
        }
      } else {
        for (let j = 1; j <= 4; j++) unchecked(stack[top++] = c * 4 + j);
      }
    }
    unchecked(velocity[2 * i] += fx); unchecked(velocity[2 * i + 1] += fy);
  }
  for (let i = 0; i < count; i++) {
    if (unchecked(pinned[i]) != 0) continue;
    const vx = Mathf.max(-500, Mathf.min(500, unchecked(velocity[2 * i]) * damping));
    const vy = Mathf.max(-500, Mathf.min(500, unchecked(velocity[2 * i + 1]) * damping));
    unchecked(velocity[2 * i] = vx); unchecked(velocity[2 * i + 1] = vy);
    unchecked(xy[2 * i] += vx); unchecked(xy[2 * i + 1] += vy);
  }
}
