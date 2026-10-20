import test from "node:test";
import assert from "node:assert/strict";
import { previewEdit, changedRange, overlayNotes } from "../src/copilotEdits.mjs";
const target = { vaultId: "v", path: "A.md", original: "before\r\nselected\r\nafter", before: "selected", from: 8, to: 16 };
const source = { path: "A.md", content: target.original, revision: "r1" };
const proposal = (content) => ({ id: "p", path: "A.md", kind: "edit", target, content });
test("live cumulative selection previews preserve outside text and CRLF", () => {
  const a = previewEdit(proposal("selected\nA"), source, "r1", "req");
  const b = previewEdit(proposal("selected\nA\nB"), source, "r1", "req", a);
  assert.equal(b.content, "before\r\nselected\r\nA\r\nB\r\nafter");
  assert.equal(b.original, source.content);
  assert.equal(b.revision, "r1");
});
test("user and disk mismatches cannot silently replace newer text", () => {
  assert.throws(() => previewEdit(proposal("new"), { ...source, content: "typed" }, "r1", "req"), /변경/);
  const a = previewEdit(proposal("new"), source, "r1", "req");
  assert.throws(() => previewEdit(proposal("next"), source, "r2", "req", a), /외부/);
  assert.throws(() => previewEdit(proposal("next"), source, "r1", "req", { ...a, userEdited: true }), /직접/);
});
test("new drafts overlay only their own path and reject existing files", () => {
  const p = { id: "n", path: "New.md", kind: "create", content: "draft" };
  const draft = previewEdit(p, null, null, "req");
  assert.equal(overlayNotes([source], [draft])[1].content, "draft");
  assert.throws(() => previewEdit(p, { path: "New.md", content: "exists" }, "r", "req"), /존재/);
});
test("changed range covers added/replaced text and preserves an unchanged suffix", () => {
  assert.deepEqual(changedRange("abc\nend", "abc\nnew\nend"), { from: 4, to: 8 });
  assert.equal(changedRange("same", "same"), null);
  assert.deepEqual(changedRange("abc", "ac"), { from: 1, to: 1 });
});
