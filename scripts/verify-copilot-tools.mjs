// Exercises the native SDK tool bridge without an account or a model request.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CopilotController } from "../electron/copilot-controller.mjs";
import { noteTools } from "../core/copilot-agent.mjs";
import { prepareRequest, sessionOptions } from "../core/copilot.mjs";

const directory = await mkdtemp(path.join(tmpdir(), "dynote-tools-probe-"));
const controller = new CopilotController({ directory, onEvent() {}, openExternal() {} });
let session;
try {
  await mkdir(path.join(directory, "workspace"));
  const client = await controller.client();
  const events = [];
  const args = prepareRequest({ requestId: "probe", vaultId: "probe-vault", mode: "agent", model: "unused", prompt: "probe", context: { kind: "document", path: "Test.md", content: "# Test\nunsaved" }, history: [] });
  const tools = noteTools({ args, canceled: () => false, emit: (type, data) => events.push({ type, ...data }) });
  session = await client.createSession(sessionOptions(null, "agent", tools));
  await session.rpc.options.update({ installedPlugins: [] });
  await session.rpc.tools.initializeAndValidate();
  const metadata = await session.rpc.tools.getCurrentMetadata();
  const names = metadata.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, tools.map((tool) => tool.name).sort());
  const result = await session.rpc.tools.execute({ name: "dynote_read_note", arguments: { path: "Test.md" } });
  assert.match(JSON.stringify(result), /unsaved/);
  await session.rpc.tools.execute({ name: "dynote_edit_note", arguments: { path: "Test.md", operation: "append", content: "\nAdded" } });
  const proposal = events.find((event) => event.type === "proposal").proposal;
  assert.equal(proposal.content, "# Test\nunsaved\nAdded");
  const report = { nativeRuntime: true, modelCalled: false, offeredTools: names, readAndDraftDispatched: true, arbitraryBuiltinToolsExcluded: true };
  await writeFile("docs/verification/copilot-tools.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (session) await (await controller.client()).deleteSession(session.sessionId);
  await controller.close();
  await rm(directory, { recursive: true, force: true });
}
