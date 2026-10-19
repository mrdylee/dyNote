import { mkdir } from "node:fs/promises";
import { main } from "assemblyscript/asc";
await mkdir(new URL("../src/generated", import.meta.url), { recursive: true });
const result = await main(["assembly/graph.ts", "--outFile", "src/generated/graph.wasm", "--optimizeLevel", "3", "--shrinkLevel", "0", "--runtime", "stub", "--noAssert", "--maximumMemory", "4096"], { stdout: process.stdout, stderr: process.stderr });
if (result.error) throw result.error;
