export const DEFAULT_FORCES = Object.freeze({ center: 0.5, repel: 1000, link: 1, distance: 250 });
export async function createKernel(bytes, { positions, links, radii }) {
  if (!(positions instanceof Float32Array) || positions.length % 2 || !positions.every(Number.isFinite)) throw new Error("Positions must be finite x/y pairs");
  const count = positions.length / 2;
  if (!(links instanceof Uint32Array) || links.length % 2 || links.some((i) => i >= count)) throw new Error("Invalid link indices");
  if (!(radii instanceof Float32Array) || radii.length !== count || radii.some((r) => !Number.isFinite(r) || r < 0 || r > 24)) throw new Error("Invalid node radii");
  const { instance } = await WebAssembly.instantiate(bytes, { env: { abort() { throw new Error("Graph WASM aborted"); } } });
  let wasm = instance.exports;
  wasm.init(count, links.length / 2);
  const xy = new Float32Array(wasm.memory.buffer, wasm.positionsPtr(), positions.length);
  xy.set(positions);
  new Uint32Array(wasm.memory.buffer, wasm.linksPtr(), links.length).set(links);
  new Float32Array(wasm.memory.buffer, wasm.radiiPtr(), radii.length).set(radii);
  wasm.prepare();
  const alive = () => { if (!wasm) throw new Error("Graph kernel disposed"); };
  const validIndex = (i) => { alive(); if (!Number.isInteger(i) || i < 0 || i >= count) throw new Error("Invalid node index"); };
  return {
    step(alpha, settings = {}) {
      alive();
      const { center, repel, link, distance } = { ...DEFAULT_FORCES, ...settings };
      if (![alpha, center, repel, link, distance].every(Number.isFinite) || alpha < 0 || alpha > 1 || center < 0 || center > 5 || repel < 0 || repel > 10000 || link < 0 || link > 2 || distance < 1 || distance > 1000) throw new Error("Invalid graph settings");
      wasm.step(alpha, center, repel, link, distance, 0.6);
    },
    positions() { alive(); return xy; },
    pin(i, x, y) { validIndex(i); if (![x, y].every(Number.isFinite)) throw new Error("Pin must be finite"); wasm.pin(i, x, y); },
    unpin(i) { validIndex(i); wasm.unpin(i); },
    memoryBytes() { alive(); return wasm.memory.buffer.byteLength; },
    dispose() { wasm = null; },
  };
}
