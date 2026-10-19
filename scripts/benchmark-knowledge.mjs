import { performance } from "node:perf_hooks";
import { buildKnowledge } from "../core/knowledge.mjs";
for (const count of [1000, 5000]) {
  const raw = Array.from({ length: count }, (_, i) => ({ path: `Note-${i}.md`, content: `# Note ${i}\n[[Note-${(i + 31) % count}]] [[Note-${(i + 62) % count}]]` }));
  let start = performance.now();
  const first = buildKnowledge(raw);
  const initialMs = performance.now() - start;
  raw[0] = { ...raw[0], content: raw[0].content + "\nOne edit" };
  start = performance.now();
  buildKnowledge(raw);
  console.log(JSON.stringify({ count, edges: first.edges.length, initialMs, editMs: performance.now() - start }));
}
