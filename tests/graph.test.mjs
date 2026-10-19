import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph, selectGraph } from "../core/graph.mjs";
const notes = ["A", "B", "C", "D"].map((path) => ({ path, tags: path === "B" ? ["한글"] : [] }));
const edges = [{ source: "A", target: "B" }, { source: "B", target: "C" }];
const ids = (g) => g.nodes.map((n) => n.path);
test("local BFS and filters keep only links with included endpoints", () => {
  const g = buildGraph(notes, edges);
  assert.deepEqual(ids(selectGraph(g, { active: "A", local: true })), ["A", "B"]);
  assert.deepEqual(ids(selectGraph(g, { active: "A", local: true, depth: 2 })), ["A", "B", "C"]);
  const filtered = selectGraph(g, { active: "A", local: true, path: "B" });
  assert.deepEqual(ids(filtered), ["B"]);
  assert.equal(filtered.links.length, 0);
  assert.deepEqual(ids(selectGraph(g, { tag: "한글" })), ["B"]);
});
test("direction and neighbor links are independent", () => {
  const g = buildGraph(notes, [...edges, { source: "A", target: "C" }]);
  assert.deepEqual(ids(selectGraph(g, { active: "B", local: true, outgoing: false })), ["A", "B"]);
  assert.deepEqual(ids(selectGraph(g, { active: "B", local: true, incoming: false })), ["B", "C"]);
  assert.equal(selectGraph(g, { active: "B", local: true, neighborLinks: false }).links.length, 4);
  assert.equal(selectGraph(g, { active: "B", local: true, neighborLinks: true }).links.length, 6);
  assert.deepEqual(ids(selectGraph(g, { active: "B", local: true, incoming: false, outgoing: false })), ["B"]);
});
test("invalid/self/duplicate links are ignored but reverse direction survives", () => {
  const g = buildGraph(notes, [...edges, edges[0], { source: "B", target: "A" }, { source: "A", target: "A" }, { source: "missing", target: "A" }]);
  assert.equal(g.links.length, 6);
  assert.deepEqual([...g.adjacency[0]], [1]);
  assert.equal(g.nodes[0].degree, 2);
  assert.equal(g.nodes[3].degree, 0);
  assert.equal(selectGraph(g, { active: "missing", local: true }).nodes.length, 0);
});
test("original synthetic local fixture has the same four immediate neighbors", () => {
  const ns = Array.from({ length: 1000 }, (_, i) => ({ path: String(i) }));
  const es = ns.flatMap((n, i) => [1, 31].map((offset) => ({ source: n.path, target: String((i + offset) % 1000) })));
  assert.deepEqual(ids(selectGraph(buildGraph(ns, es), { active: "44", local: true })), ["13", "43", "44", "45", "75"]);
});
