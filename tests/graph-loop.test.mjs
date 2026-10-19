import test from "node:test";
import assert from "node:assert/strict";
import { createSimulationLoop } from "../core/graph-loop.mjs";
function harness() {
  const jobs = new Map(), sent = [], kernels = []; let id = 0;
  const loop = createSimulationLoop({
    createKernel: async (_bytes, input) => {
      const kernel = { steps: 0, pins: [], step() { this.steps++; }, positions: () => input.positions, pin(...args) { this.pins.push(args); }, unpin() {}, dispose() { this.disposed = true; } };
      kernels.push(kernel); return kernel;
    },
    bytes: Promise.resolve(new Uint8Array()),
    send: (message) => sent.push(message),
    schedule: (fn) => { jobs.set(++id, fn); return id; },
    cancel: (id) => jobs.delete(id),
  });
  const tick = () => { const [id, fn] = jobs.entries().next().value ?? []; if (fn) { jobs.delete(id); fn(); } };
  return { loop, jobs, sent, kernels, tick };
}
const graph = (epoch) => ({ type: "graph", epoch, positions: new Float32Array([1, 2]), links: new Uint32Array(), radii: new Float32Array([5]) });
test("frames are bounded, recycled, paused and isolated by epoch", async () => {
  const h = harness(); await h.loop.receive(graph(1));
  h.tick(); h.tick(); h.tick(); assert.equal(h.sent.length, 2); assert.equal(h.jobs.size, 0);
  await h.loop.receive({ type: "recycle", epoch: 1, buffer: h.sent[0].buffer });
  h.tick(); assert.equal(h.sent.length, 3);
  await h.loop.receive({ type: "pause", epoch: 1 }); assert.equal(h.jobs.size, 0);
  await h.loop.receive(graph(2)); assert.equal(h.kernels[0].disposed, true);
  await h.loop.receive({ type: "pin", epoch: 1, index: 0, x: 0, y: 0 });
  assert.equal(h.kernels[1].pins.length, 0);
  await h.loop.receive({ type: "recycle", epoch: 1, buffer: h.sent[1].buffer });
  h.tick(); h.tick(); h.tick(); assert.equal(h.sent.filter((m) => m.epoch === 2).length, 2);
  h.loop.destroy(); assert.equal(h.jobs.size, 0);
});
test("cooling stops scheduling and resume does not reheat a settled graph", async () => {
  const h = harness(); await h.loop.receive(graph(1));
  for (let i = 0; i < 500 && h.jobs.size; i++) {
    h.tick(); await h.loop.receive({ type: "recycle", epoch: 1, buffer: h.sent.at(-1).buffer });
  }
  assert.equal(h.sent.at(-1).settled, true); assert.equal(h.jobs.size, 0);
  await h.loop.receive({ type: "resume", epoch: 1 }); assert.equal(h.jobs.size, 0);
  await h.loop.receive({ type: "settings", epoch: 1, settings: { repel: 2000 } }); assert.equal(h.jobs.size, 1);
});
