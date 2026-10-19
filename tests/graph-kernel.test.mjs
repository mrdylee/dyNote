import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createKernel } from "../core/graph-kernel.mjs";
const bytes = await readFile(new URL("../src/generated/graph.wasm", import.meta.url));
const make = (points, links = []) => createKernel(bytes, { positions: Float32Array.from(points), links: Uint32Array.from(links), radii: new Float32Array(points.length / 2).fill(5) });
const distance = (p) => Math.hypot(p[0] - p[2], p[1] - p[3]);
test("center pulls inward; pin survives stepping; empty/disposed graphs are safe", async () => {
  const k = await make([100, 100]);
  k.step(1, { center: 0.1, repel: 0, link: 0 });
  assert.ok(k.positions()[0] < 100);
  k.pin(0, 123, 456); k.step(1);
  assert.deepEqual([...k.positions()], [123, 456]);
  k.unpin(0); k.step(1); assert.notEqual(k.positions()[0], 123);
  k.dispose(); assert.throws(() => k.step(1), /disposed/);
  const empty = await make([]); empty.step(1); assert.equal(empty.positions().length, 0);
});
test("springs reduce both too long and too short link error", async () => {
  for (const length of [20, 400]) {
    const k = await make([-length / 2, 0, length / 2, 0], [0, 1]);
    for (let i = 0; i < 50; i++) k.step(0.2, { center: 0, repel: 0, link: 1, distance: 100 });
    assert.ok(Math.abs(distance(k.positions()) - 100) < Math.abs(length - 100));
  }
});
test("overlaps separate and clustered/hub/isolated inputs remain finite", async () => {
  for (const mode of ["overlap", "hub", "isolated"]) {
    const n = 300, p = new Float32Array(n * 2), links = [];
    for (let i = 0; i < n; i++) {
      if (mode !== "overlap") { p[2 * i] = Math.cos(i * 2.4) * Math.sqrt(i) * 25; p[2 * i + 1] = Math.sin(i * 2.4) * Math.sqrt(i) * 25; }
      if (mode === "hub" && i) links.push(0, i);
    }
    const k = await createKernel(bytes, { positions: p, links: Uint32Array.from(links), radii: new Float32Array(n).fill(5) });
    for (let i = 0; i < 300; i++) k.step(Math.max(0.01, Math.exp(-i / 60)));
    assert.ok(k.positions().every(Number.isFinite), mode);
    assert.ok(distance(k.positions()) > 1, mode);
  }
});
test("invalid arrays and settings cannot corrupt simulation memory", async () => {
  await assert.rejects(() => make([0, 0], [0, 2]), /link/);
  await assert.rejects(() => make([NaN, 0]), /finite/);
  const k = await make([0, 0]);
  assert.throws(() => k.pin(2, 0, 0), /index/);
  assert.throws(() => k.step(1, { center: NaN }), /settings/);
});
