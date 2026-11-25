import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { scanApiFiles } from "../core/github-api-sync.mjs";
import { blobSha } from "../core/github-remote.mjs";
import { Vault } from "../core/vault.mjs";

// Measure only the local part of a REST sync. No account or network is used.
const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), "dynote-scan-bench-")));
const original = Buffer.alloc(4096, 65);
const results = [];
try {
  for (const count of [100, 1000]) {
    const root = path.join(scratch, String(count));
    const vault = new Vault(root, path.join(scratch, "recovery"));
    const target = "notes-0/0.md";
    for (let first = 0; first < count; first += 100) {
      const folder = path.join(root, `notes-${first / 100}`);
      await mkdir(folder, { recursive: true });
      await Promise.all(Array.from({ length: 100 }, (_, i) => writeFile(path.join(folder, `${i}.md`), original)));
    }

    let expected = blobSha(original);
    for (let round = 1; round <= 5; round++) {
      const cache = new Map();
      const sample = { count, round };
      for (const scenario of ["emptyHashCache", "unchanged", "oneEdit"]) {
        if (scenario === "oneEdit") {
          const edited = Buffer.alloc(original.length, 65 + round);
          await writeFile(path.join(root, target), edited);
          expected = blobSha(edited);
        }
        const start = performance.now();
        const files = await scanApiFiles(vault, cache);
        sample[scenario] = Number((performance.now() - start).toFixed(2));
        assert.equal(files.size, count);
        assert.equal(files.get(target), expected);
      }
      results.push(sample);
    }
  }
  console.log(JSON.stringify({ platform: `${os.platform()}-${os.arch()}`, node: process.version, noteBytes: original.length, unit: "ms", results }, null, 2));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
