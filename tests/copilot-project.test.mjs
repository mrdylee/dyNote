import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { configureProjectTools } from "../electron/copilot-project.mjs";
import { sessionOptions } from "../core/copilot.mjs";

test("project changes preserve an outside edit or new file made during approval", async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "dynote-project-write-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "sample.js");
  const options = sessionOptions(null, "agent");
  configureProjectTools(options, { root, signal: new AbortController().signal, emit() {},
    confirm: async () => { await writeFile(file, "manual"); return true; } });
  const call = (kind, args) => options.tools.find(t => t.name === "dynote_project_" + kind).handler({ path: "sample.js", ...args });
  assert.equal((await call("create", { file_text: "generated" })).resultType, "failure");
  assert.equal(await readFile(file, "utf8"), "manual");
  await writeFile(file, "first");
  assert.equal((await call("edit", { old_str: "first", new_str: "second" })).resultType, "failure");
  assert.equal(await readFile(file, "utf8"), "manual");
  assert.equal((await call("edit", { path: "../other.js", old_str: "X", new_str: "Y" })).resultType, "failure");
});
