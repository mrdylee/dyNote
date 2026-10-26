import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSimulationLoop } from "../core/graph-loop.mjs";
import { createKernel } from "../core/graph-kernel.mjs";
function harness() {
  const jobs = new Map(), sent = [], kernels = []; let id = 0;
  const loop = createSimulationLoop({
    createKernel: async (_bytes, input) => {
      const kernel = { steps: 0, alphas: [], pins: [], step(alpha) { this.steps++; this.alphas.push(alpha); }, positions: () => input.positions, pin(...args) { this.pins.push(args); }, unpin() {}, dispose() { this.disposed = true; } };
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
  await h.loop.receive({ type: "unpin", epoch: 1, index: 0 }); assert.equal(h.jobs.size, 0);
  await h.loop.receive({ type: "settings", epoch: 1, settings: { repel: 2000 } }); assert.equal(h.jobs.size, 1);
});

test("a stationary drag keeps forces active until the last node is released", async () => {
  const h = harness();
  await h.loop.receive({ ...graph(1), positions: new Float32Array([1, 2, 3, 4]), radii: new Float32Array([5, 5]) });
  await h.loop.receive({ type: "pin", epoch: 1, index: 0, x: 100, y: 200 });
  await h.loop.receive({ type: "pin", epoch: 1, index: 1, x: 300, y: 400 });
  for (let i = 0; i < 200; i++) {
    h.tick(); await h.loop.receive({ type: "recycle", epoch: 1, buffer: h.sent.at(-1).buffer });
  }
  assert.equal(h.kernels[0].steps, 200);
  assert.ok(h.kernels[0].alphas.every((alpha) => alpha === 0.3));
  assert.equal(h.sent.at(-1).settled, false);
  await h.loop.receive({ type: "unpin", epoch: 1, index: 0 });
  h.tick(); await h.loop.receive({ type: "recycle", epoch: 1, buffer: h.sent.at(-1).buffer });
  assert.equal(h.kernels[0].alphas.at(-1), 0.3);
  await h.loop.receive({ type: "unpin", epoch: 1, index: 1 });
  for (let i = 0; i < 500 && h.jobs.size; i++) {
    h.tick(); await h.loop.receive({ type: "recycle", epoch: 1, buffer: h.sent.at(-1).buffer });
  }
  assert.equal(h.sent.at(-1).settled, true);
  assert.equal(h.jobs.size, 0);
  h.loop.destroy();
});

test("releasing a node does not restart cooling from the initial temperature", async () => {
  const h = harness(); await h.loop.receive(graph(1));
  h.tick();
  await h.loop.receive({ type: "unpin", epoch: 1, index: 0 });
  h.tick();
  assert.equal(h.kernels[0].alphas[1], 0.3 * 0.97);
  h.loop.destroy();
});

test("an obsolete async initialization is disposed and cannot send frames", async () => {
  const pending = [], sent = [], jobs = new Map(); let id = 0;
  const loop = createSimulationLoop({ bytes: new Uint8Array(), createKernel: () => new Promise((resolve) => pending.push(resolve)), send: (m) => sent.push(m), schedule: (fn) => { jobs.set(++id, fn); return id; }, cancel: (id) => jobs.delete(id) });
  const first = loop.receive(graph(1)); await Promise.resolve();
  const second = loop.receive(graph(2)); await Promise.resolve();
  const obsolete = { dispose() { this.disposed = true; } };
  pending[0](obsolete); await first;
  assert.equal(obsolete.disposed, true); assert.equal(jobs.size, 0);
  const current = { positions: () => new Float32Array([1, 2]), dispose() { this.disposed = true; } };
  loop.destroy(); pending[1](current); await second;
  assert.equal(current.disposed, true); assert.equal(jobs.size, 0); assert.deepEqual(sent, []);
});

test("an empty filter stops the previous graph without scheduling empty frames", async () => {
  const h = harness(); await h.loop.receive(graph(1));
  await h.loop.receive({ ...graph(2), positions: new Float32Array(), radii: new Float32Array() });
  assert.equal(h.kernels[0].disposed, true);
  assert.equal(h.jobs.size, 0);
  await h.loop.receive({ type: "settings", epoch: 2, settings: { repel: 2000 } });
  await h.loop.receive({ type: "resume", epoch: 2 });
  assert.equal(h.jobs.size, 0);
  assert.deepEqual(h.sent, []);
  await h.loop.receive(graph(3));
  h.tick(); assert.equal(h.sent[0].epoch, 3);
});

test("dragging before async kernel startup preserves the latest pin and release", async () => {
  const pending = [];
  const loop = createSimulationLoop({ bytes: new Uint8Array(), createKernel: () => new Promise((resolve) => pending.push(resolve)), send() {}, schedule: () => 1, cancel() {} });
  const install = async (epoch) => {
    const ready = loop.receive(graph(epoch)); await Promise.resolve();
    const kernel = { pins: [], releases: [], pin(...args) { this.pins.push(args); }, unpin(index) { this.releases.push(index); }, positions: () => new Float32Array([1, 2]), dispose() {} };
    return { ready, kernel, resolve: () => pending.shift()(kernel) };
  };
  const first = await install(1);
  await loop.receive({ type: "pin", epoch: 1, index: 0, x: 10, y: 20 });
  await loop.receive({ type: "pin", epoch: 1, index: 0, x: 30, y: 40 });
  first.resolve(); await first.ready;
  assert.deepEqual(first.kernel.pins, [[0, 30, 40]]);
  const second = await install(2);
  await loop.receive({ type: "pin", epoch: 2, index: 0, x: 50, y: 60 });
  await loop.receive({ type: "unpin", epoch: 2, index: 0 });
  second.resolve(); await second.ready;
  assert.deepEqual(second.kernel.pins, [[0, 50, 60]]);
  assert.deepEqual(second.kernel.releases, [0]);
  loop.destroy();
});

test("a long drag relocates a linked graph before release without permanently pinning it", async () => {
  const jobs = new Map(), sent = []; let id = 0;
  const loop = createSimulationLoop({
    bytes: await readFile(new URL("../src/generated/graph.wasm", import.meta.url)), createKernel,
    send: (message) => sent.push(message),
    schedule: (fn) => { jobs.set(++id, fn); return id; }, cancel: (id) => jobs.delete(id),
  });
  const tick = async () => {
    const [id, fn] = jobs.entries().next().value ?? [];
    if (!fn) return;
    jobs.delete(id); fn();
    await loop.receive({ type: "recycle", epoch: 1, buffer: sent.at(-1).buffer });
  };
  await loop.receive({ type: "graph", epoch: 1, positions: new Float32Array([-125, 0, 125, 0]), links: new Uint32Array([0, 1]), radii: new Float32Array([5, 5]), settings: { center: 0, repel: 0, link: 1, distance: 250 } });
  for (let i = 0; i < 500 && jobs.size; i++) await tick();
  await loop.receive({ type: "pin", epoch: 1, index: 0, x: 500, y: 500 });
  for (let i = 0; i < 400; i++) await tick();
  const held = new Float32Array(sent.at(-1).buffer).slice();
  assert.equal(held[0], 500); assert.equal(held[1], 500);
  assert.ok(Math.abs(Math.hypot(held[2] - 500, held[3] - 500) - 250) < 1);
  await loop.receive({ type: "unpin", epoch: 1, index: 0 });
  for (let i = 0; i < 500 && jobs.size; i++) await tick();
  const released = new Float32Array(sent.at(-1).buffer).slice();
  assert.ok(Math.hypot(released[0] - 500, released[1] - 500) < 5);
  await loop.receive({ type: "settings", epoch: 1, settings: { center: 1, link: 0 } });
  await tick();
  assert.ok(new Float32Array(sent.at(-1).buffer)[0] < released[0]);
  loop.destroy();
});
