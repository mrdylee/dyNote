import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AiExtensions } from "../electron/ai-extensions.mjs";

async function fixture(run) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-ai-extensions-")));
  try { await run({ root, registry: new AiExtensions({ file: path.join(root, "selected.json") }) }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("MCP references survive restart while secrets remain only in the selected config", () => fixture(async ({ root, registry }) => {
  const file = path.join(root, "mcp.json"), skills = path.join(root, "skills");
  await mkdir(skills);
  await writeFile(file, JSON.stringify({ mcpServers: {
    local: { command: "node", args: ["server.mjs"], env: { MCP_TOKEN: "secret-local" } },
    remote: { type: "http", url: "https://mcp.example.test/api?token=secret-query", headers: { Authorization: "Bearer secret-header" }, tools: ["search"] },
  } }));
  await registry.load(); await registry.addConfig(file); await registry.addSkills(skills);
  const stored = await readFile(path.join(root, "selected.json"), "utf8");
  assert.ok(!stored.includes("secret"));
  const restarted = new AiExtensions({ file: path.join(root, "selected.json") }); await restarted.load();
  const extensions = await restarted.getExtensions();
  assert.deepEqual(extensions.skillDirectories, [skills]);
  assert.equal(extensions.mcpServers.local.type, "local");
  assert.equal(extensions.mcpServers.local.cwd, root);
  assert.equal(extensions.mcpServers.local.env.MCP_TOKEN, "secret-local");
  assert.deepEqual(extensions.mcpServers.remote.tools, ["search"]);
  const snapshot = await restarted.snapshot();
  assert.deepEqual(snapshot.servers, [{ name: "local", transport: "local" }, { name: "remote", transport: "http" }]);
  assert.equal(snapshot.configs[0].name, "mcp.json");
  assert.ok(!JSON.stringify(snapshot).includes("secret"));
  const original = await readFile(file, "utf8");
  await restarted.remove({ kind: "config", path: file });
  assert.deepEqual((await restarted.getExtensions()).mcpServers, {});
  assert.equal(await readFile(file, "utf8"), original);
}));

test("invalid MCP files are rejected without replacing existing selections", () => fixture(async ({ root, registry }) => {
  await registry.load();
  for (const [index, value] of [
    "{broken-secret", { mcpServers: { bad: { url: "file:///private" } } },
    { mcpServers: { bad: { command: "node", args: [42] } } },
    { mcpServers: { bad: { command: "node", env: { TOKEN: 42 } } } },
    { mcpServers: { bad: { command: "node", url: "https://mcp.example.test" } } },
    { mcpServers: { bad: { type: "other", command: "node" } } },
    { mcpServers: { bad: { command: "" } } }, { mcpServers: [] },
  ].entries()) {
    const file = path.join(root, `bad-${index}.json`);
    await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
    await assert.rejects(registry.addConfig(file), /MCP/);
  }
  assert.deepEqual((await registry.snapshot()).configs, []);
}));

test("mutated config errors are sanitized and block inference instead of partly loading", () => fixture(async ({ root, registry }) => {
  await registry.load(); const file = path.join(root, "mcp.json");
  await writeFile(file, JSON.stringify({ mcpServers: { fixture: { command: "node" } } }));
  await registry.addConfig(file);
  await writeFile(file, '{"secret-token":"credential",broken');
  const snapshot = await registry.snapshot();
  assert.equal(snapshot.errors.length, 1);
  assert.ok(!JSON.stringify(snapshot).includes("credential"));
  await assert.rejects(registry.getExtensions(), /MCP/);
}));

test("duplicate server names cannot silently replace a previously selected server", () => fixture(async ({ root, registry }) => {
  await registry.load();
  const first = path.join(root, "first.json"), second = path.join(root, "second.json");
  await writeFile(first, JSON.stringify({ mcpServers: { same: { command: "node" } } }));
  await writeFile(second, JSON.stringify({ mcpServers: { same: { command: "other" } } }));
  await registry.addConfig(first);
  await assert.rejects(registry.addConfig(second), /중복/);
  assert.deepEqual((await registry.snapshot()).configs.map(config => config.path), [first]);
}));

test("skill directory selections are bounded and removal does not delete source files", () => fixture(async ({ root, registry }) => {
  await registry.load(); const directory = path.join(root, "skill"), file = path.join(root, "not-directory");
  await mkdir(directory); await writeFile(path.join(directory, "SKILL.md"), "# Public fixture"); await writeFile(file, "text");
  await assert.rejects(registry.addSkills(file), /스킬/);
  await assert.rejects(registry.addSkills("relative"), /경로/);
  await registry.addSkills(directory); await registry.addSkills(directory);
  assert.deepEqual((await registry.getExtensions()).skillDirectories, [directory]);
  await registry.remove({ kind: "skills", path: directory });
  assert.equal(await readFile(path.join(directory, "SKILL.md"), "utf8"), "# Public fixture");
  assert.deepEqual((await registry.getExtensions()).skillDirectories, []);
}));

test("corrupt registry is preserved and cannot silently be reset", () => fixture(async ({ root, registry }) => {
  const file = path.join(root, "selected.json"); await writeFile(file, "{broken");
  await assert.rejects(registry.load(), /설정/);
  assert.equal(await readFile(file, "utf8"), "{broken");
}));
