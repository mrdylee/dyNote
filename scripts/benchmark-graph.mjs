import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import os from "node:os";
import { createKernel } from "../core/graph-kernel.mjs";
const bytes = await readFile(new URL("../src/generated/graph.wasm", import.meta.url));
export function fixture(count, density, pattern = "spiral") {
  const positions = new Float32Array(count * 2), links = new Uint32Array(count * density * 2);
  for (let i = 0; i < count; i++) {
    const radius = Math.sqrt(i + 1) * 25, angle = i * 2.399963229728653;
    positions[2 * i] = Math.cos(angle) * radius;
    positions[2 * i + 1] = Math.sin(angle) * radius;
    if (pattern === "clustered") { positions[2 * i] = i % 4 * 1000 + Math.cos(angle) * 20; positions[2 * i + 1] = Math.sin(angle) * 20; }
    for (let k = 1; k <= density; k++) {
      const offset = (i * density + k - 1) * 2;
      links[offset] = pattern === "hub" ? 0 : i;
      links[offset + 1] = pattern === "hub" ? (i + k) % count : (i + k * 31) % count;
    }
  }
  return { positions, links, radii: new Float32Array(count).fill(5) };
}
const results = [];
for (const pattern of ["spiral", "clustered", "hub", "isolated"]) {
  for (const count of pattern === "spiral" ? [1000, 5000, 10000] : [10000]) {
    for (const density of pattern === "spiral" ? [2, 8] : pattern === "isolated" ? [0] : [2]) {
      const samples = []; let memoryBytes = 0;
      for (let run = 0; run < 3; run++) {
        const k = await createKernel(bytes, fixture(count, density, pattern));
        let alpha = 0.3;
        for (let i = 0; i < 40; i++) {
          alpha *= Math.pow(0.001, 1 / 300);
          const start = performance.now(); k.step(alpha);
          if (i >= 10) samples.push(performance.now() - start);
        }
        if (!k.positions().every(Number.isFinite)) throw new Error("Non-finite graph");
        memoryBytes = k.memoryBytes(); k.dispose();
      }
      samples.sort((a, b) => a - b);
      const row = { pattern, nodes: count, edges: count * density, samples: samples.length, medianMs: samples[45], p95Ms: samples[85], memoryBytes, finite: true };
      results.push(row); console.log(JSON.stringify(row));
    }
  }
}
const report = { createdAt: new Date().toISOString(), node: process.version, cpu: os.cpus()[0]?.model, scope: "Kernel only: 10 warmup + 30 measured steps, 3 runs; same spiral coordinates/links as research baseline, independent force semantics, no renderer or Worker", results };
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + "\n");
