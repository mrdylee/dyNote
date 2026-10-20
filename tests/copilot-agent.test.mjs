import test from "node:test";
import assert from "node:assert/strict";
import { noteTools } from "../core/copilot-agent.mjs";
import { prepareRequest, sessionOptions, applyProposal } from "../core/copilot.mjs";

const current = { kind: "document", path: "Current.md", content: "unsaved\r\ntext" };
const request = (extra = {}) => prepareRequest({ requestId: "agent-1", vaultId: "v", model: "test", mode: "agent", prompt: "write", context: current, history: [], ...extra });
function fixture(extra = {}) {
  const events = [];
  let loads = 0, canceled = false;
  const args = request(extra);
  const tools = noteTools({ args, getNotes: async (id) => {
    assert.equal(id, "v"); loads++;
    return [{ path: "Current.md", content: "disk version" }, { path: "Other.md", content: "battery test" }];
  }, emit: (type, data) => events.push({ type, ...data }), canceled: () => canceled });
  return { tools, events, get loads() { return loads; }, cancel() { canceled = true; },
    call(name, args) { return tools.find((t) => t.name === `dynote_${name}`).handler(args); } };
}
test("agent request validates attachments and default scope", () => {
  assert.equal(request().vaultAccess, false);
  assert.deepEqual(request().references, []);
  assert.throws(() => request({ references: Array(6).fill({ path: "A.md", content: "a" }) }), /첨부/);
  assert.throws(() => request({ references: [{ path: "A.md", content: "a".repeat(65537) }] }), /첨부/);
  assert.throws(() => request({ vaultAccess: "yes" }), /접근/);
});
test("agent exposes only custom tools; ask remains tool-free", () => {
  const f = fixture();
  assert.deepEqual(sessionOptions("test", "agent", f.tools).availableTools, f.tools.map((t) => t.name));
  assert.deepEqual(sessionOptions("test", "chat", f.tools).availableTools, []);
});
test("reads unsaved context without vault access; cannot read unattached notes", async () => {
  const f = fixture();
  const read = await f.call("read_note", { path: "Current.md" });
  assert.match(read.textResultForLlm, /unsaved/);
  assert.equal((await f.call("read_note", { path: "Other.md" })).resultType, "failure");
  assert.equal(f.loads, 0);
});
test("authorized search is bounded and read caches the original for review", async () => {
  const f = fixture({ vaultAccess: true });
  assert.match((await f.call("search_notes", { query: "battery" })).textResultForLlm, /Other.md/);
  assert.equal((await f.call("edit_note", { path: "Other.md", operation: "replace", content: "new" })).resultType, "failure");
  await f.call("read_note", { path: "Other.md" });
  await f.call("edit_note", { path: "Other.md", operation: "append", content: "\nnew" });
  const draft = f.events.find((e) => e.type === "proposal").proposal;
  assert.equal(draft.content, "battery test\nnew");
  assert.equal(applyProposal(draft.target, { vaultId: "v", path: "Other.md", content: "battery test" }, draft.content), draft.content);
  assert.throws(() => applyProposal(draft.target, { vaultId: "v", path: "Other.md", content: "user typed" }, draft.content), /변경/);
  assert.equal(f.loads, 1);
});
test("selection cannot expand to the full disk document even with vault access", async () => {
  const f = fixture({ vaultAccess: true, context: { ...current, kind: "selection", content: "selected only" } });
  const read = await f.call("read_note", { path: "Current.md" });
  assert.match(read.textResultForLlm, /selected only/);
  assert.doesNotMatch(read.textResultForLlm, /disk version/);
  await f.call("edit_note", { path: "Current.md", operation: "prepend", content: "prefix " });
  assert.equal(f.events.find((e) => e.type === "proposal").proposal.content, "prefix selected only");
});
test("new-note drafts validate paths, never read or write the vault, and cap proposals", async () => {
  const f = fixture();
  for (const path of ["../secret.md", "/tmp/x.md", ".git/x.md", "a\\b.md", "x.exe"])
    assert.equal((await f.call("create_note", { path, content: "new" })).resultType, "failure");
  assert.equal((await f.call("create_note", { path: "New.md", content: "# New" })).resultType, "success");
  assert.equal(f.events.find((e) => e.type === "proposal").proposal.kind, "create");
  assert.equal(f.loads, 0);
  for (let i = 0; i < 4; i++) await f.call("create_note", { path: `New${i}.md`, content: "new" });
  assert.equal((await f.call("create_note", { path: "six.md", content: "new" })).resultType, "failure");
});
test("cancel, oversized content and call budget cannot stage writes", async () => {
  const f = fixture();
  assert.equal((await f.call("create_note", { path: "Large.md", content: "x".repeat(131073) })).resultType, "failure");
  f.cancel();
  assert.equal((await f.call("create_note", { path: "No.md", content: "new" })).resultType, "failure");
  assert.equal(f.events.filter((e) => e.type === "proposal").length, 0);
  const g = fixture();
  for (let i = 0; i < 24; i++) await g.call("read_note", { path: "Current.md" });
  assert.equal((await g.call("create_note", { path: "No.md", content: "new" })).resultType, "failure");
});
test("reference text is scoped; duplicate current path cannot expand selection", async () => {
  const f = fixture({ references: [{ path: "Ref.md", content: "attached buffer" }] });
  assert.match((await f.call("read_note", { path: "Ref.md" })).textResultForLlm, /attached buffer/);
  assert.throws(() => request({ references: [{ path: current.path, content: "extra" }] }), /중복/);
});
test("successive edits stream cumulative drafts with a stable identity and original baseline", async () => {
  const f = fixture();
  await f.call("read_note", { path: "Current.md" });
  assert.equal((await f.call("edit_note", { path: "Current.md", operation: "append", content: "\nA" })).resultType, "success");
  assert.equal((await f.call("edit_note", { path: "Current.md", operation: "append", content: "\nB" })).resultType, "success");
  assert.match((await f.call("read_note", { path: "Current.md" })).textResultForLlm, /A\\nB/);
  const drafts = f.events.filter((e) => e.type === "proposal").map((e) => e.proposal);
  assert.equal(drafts[0].id, drafts[1].id);
  assert.equal(drafts[1].content, current.content + "\nA\nB");
  assert.equal(drafts[1].target.original, current.content);
});
test("new note can be read and extended before acceptance without becoming an existing-note edit", async () => {
  const f = fixture();
  await f.call("create_note", { path: "New.md", content: "# New" });
  await f.call("read_note", { path: "New.md" });
  assert.equal((await f.call("edit_note", { path: "New.md", operation: "append", content: "\nNext" })).resultType, "success");
  assert.equal(f.events.filter((e) => e.type === "proposal").at(-1).proposal.kind, "create");
  assert.equal((await f.call("create_note", { path: "New.md", content: "duplicate" })).resultType, "failure");
});
