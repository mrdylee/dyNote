import test from "node:test";
import assert from "node:assert/strict";
import * as graph from "../core/graph.mjs";
import { buildKnowledge } from "../core/knowledge.mjs";
const fixture = () => buildKnowledge([
  { path: "work/A.md", content: '# Alpha\n[[B]] [[Future]] ![[photo.png]] [[https://example.com]]\n#team/project', metadata: { ctime: 30, mtime: 40 } },
  { path: "B.md", content: '# Beta', metadata: { ctime: 10, mtime: 20 } },
  { path: "Orphan.md", content: '# Alone' },
]);
const ids = (g) => g.nodes.map((n) => n.path);
test("vault graph exposes tags, attachments and missing links without unsafe nodes", () => {
  assert.equal(typeof graph.buildVaultGraph, "function");
  const model = fixture();
  const g = graph.buildVaultGraph(model.notes, model.edges, [{ path: "photo.png" }, { path: "unused.pdf" }]);
  const all = graph.selectGraph(g, { showTags: true, showAttachments: true });
  assert.equal(all.nodes.length, 7);
  assert.equal(all.links.length / 2, 4);
  assert.equal(all.nodes.filter((n) => n.type === "missing").length, 1);
  assert.ok(!ids(all).some((p) => p.includes("https:")));
  assert.equal(graph.selectGraph(g, { existingOnly: true }).nodes.length, 3);
  assert.equal(graph.selectGraph(g, { existingOnly: true, showOrphans: false }).nodes.length, 2);
  assert.equal(graph.selectGraph(g, { query: "file:Alpha", showOrphans: false }).nodes.length, 0);
  const tags = graph.selectGraph(g, { showTags: true, existingOnly: true });
  assert.equal(tags.nodes.filter((n) => n.type === "tag").length, 1);
});
test("query matches Unicode phrases, typed conditions and exclusions with AND", () => {
  assert.equal(typeof graph.graphQuery, "function");
  const note = { path: 'work/한글 노트.md', title: '테스트 문서', tags: ['team/project'] };
  assert.ok(graph.graphQuery('path:work tag:#team "한글 노트"')(note));
  assert.ok(!graph.graphQuery('path:work -tag:team')(note));
  assert.ok(graph.graphQuery('file:"테스트 문서" -path:archive')(note));
  assert.ok(!graph.graphQuery('다른 문서')(note));
  assert.ok(graph.graphQuery('tag:team/*')(note));
});
test("first matching nonempty group wins, invalid colors are ignored", () => {
  assert.equal(typeof graph.graphColors, "function");
  const nodes = [{ path: 'work/A.md', tags: ['team'] }, { path: 'B.md' }];
  const groups = [{ query: '', color: '#ffffff' }, { query: 'tag:team', color: '#ff0000' }, { query: 'path:work', color: '#00ff00' }];
  assert.deepEqual(graph.graphColors(nodes, groups), [0xff0000, null]);
  assert.deepEqual(graph.graphColors(nodes, [groups[2], groups[1]]), [0x00ff00, null]);
  assert.deepEqual(graph.graphColors(nodes, [{ query: 'A', color: 'url(bad)' }]), [null, null]);
});
test("replay reveals files chronologically and synthetic nodes with earliest neighbor", () => {
  assert.equal(typeof graph.graphReplayOrder, "function");
  const model = fixture();
  const g = graph.selectGraph(graph.buildVaultGraph(model.notes, model.edges, [{ path: 'photo.png' }]), { showTags: true, showAttachments: true });
  const order = graph.graphReplayOrder(g);
  assert.equal(order[g.index.get('B.md')], 0);
  const a = order[g.index.get('work/A.md')];
  for (let i = 0; i < g.nodes.length; i++) if (['tag', 'missing', 'attachment'].includes(g.nodes[i].type)) assert.equal(order[i], a);
  assert.ok(order[g.index.get('Orphan.md')] > a);
});
test("ambiguous links do not become fake missing files and relative assets resolve", () => {
  assert.equal(typeof graph.buildVaultGraph, "function");
  const m = buildKnowledge([{ path: 'A.md', content: '[[B]] ![p](assets/p.png) [[../../escape]]' }, { path: 'one/B.md', content: '' }, { path: 'two/B.md', content: '' }]);
  const g = graph.buildVaultGraph(m.notes, m.edges, [{ path: 'assets/p.png' }]);
  assert.equal(g.nodes.filter((n) => n.type === 'missing').length, 0);
  assert.equal(g.links.length, 2);
});
test("stored graph options clamp values, preserve booleans and migrate old label control", async () => {
  const { normalizeGraphSettings, GRAPH_DEFAULTS } = await import('../core/graph-options.mjs');
  const s = normalizeGraphSettings({ center: 999, repel: -1, labelThreshold: NaN, showTags: 'yes', groups: [{ query: 'tag:x', color: '#00aa11' }, { query: 1, color: 'bad' }], panelOpen: false });
  assert.equal(s.center, 5); assert.equal(s.repel, 0);
  assert.equal(s.labelThreshold, GRAPH_DEFAULTS.labelThreshold);
  assert.equal(s.showTags, false); assert.equal(s.panelOpen, false);
  assert.deepEqual(s.groups, [{ query: 'tag:x', color: '#00aa11' }]);
  assert.equal(normalizeGraphSettings({ labels: 0 }).labelThreshold, 3);
  assert.deepEqual(normalizeGraphSettings(null), GRAPH_DEFAULTS);
});
test("replay without timestamps still reveals synthetic nodes with their owning note", () => {
  const m = buildKnowledge([{ path: 'A.md', content: '[[Future]] #team' }, { path: 'B.md', content: '' }]);
  const g = graph.selectGraph(graph.buildVaultGraph(m.notes, m.edges), { showTags: true });
  const ranks = graph.graphReplayOrder(g);
  for (let i = 0; i < g.nodes.length; i++) if (['tag', 'missing'].includes(g.nodes[i].type)) assert.equal(ranks[i], ranks[g.index.get('A.md')]);
});
