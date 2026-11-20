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
test("later requests refine the current draft while retaining the first original and revision", () => {
  const first = previewEdit(proposal("first"), source, "r1", "one");
  const baseline = { ...source, content: first.content };
  const next = { id: "next", kind: "edit", path: source.path, target: { ...target, original: baseline.content, before: "first", from: 8, to: 13 }, content: "second" };
  const second = previewEdit(next, source, "r1", "two", first, baseline);
  assert.equal(second.content, "before\r\nsecond\r\nafter");
  assert.equal(second.original, source.content);
  assert.equal(second.revision, "r1");
  assert.equal(second.id, first.id);
  const third = previewEdit({ ...next, content: "second\nmore" }, source, "r1", "two", second, baseline);
  assert.equal(third.content, "before\r\nsecond\r\nmore\r\nafter");
});
test("a later request can refine an unsaved new note without changing its create identity", () => {
  const first = previewEdit({ id: "new", kind: "create", path: "New.md", content: "draft" }, null, null, "one");
  const baseline = { path: first.path, content: first.content, revision: null };
  const next = { id: "edit", kind: "edit", path: first.path, target: { vaultId: "v", path: first.path, original: "draft", before: "draft", from: 0, to: 5 }, content: "refined draft" };
  const second = previewEdit(next, null, null, "two", first, baseline);
  assert.equal(second.kind, "create");
  assert.equal(second.original, "");
  assert.equal(second.revision, null);
  assert.equal(second.content, "refined draft");
  assert.throws(() => previewEdit(next, null, "external", "two", first, baseline), /외부|존재/);
  assert.throws(() => previewEdit({ ...next, kind: "create" }, null, null, "two", first, baseline), /존재/);
});
test("explicit follow-up includes prior user edits but rejects typing after the request snapshot", () => {
  const first = { ...previewEdit(proposal("first"), source, "r1", "one"), content: "user text", userEdited: true };
  const baseline = { ...source, content: first.content, userEdited: true };
  const next = { id: "edit", kind: "edit", path: source.path, target: { vaultId: "v", path: source.path, original: "user text", before: "user text", from: 0, to: 9 }, content: "user text + AI" };
  const second = previewEdit(next, source, "r1", "two", first, baseline);
  assert.equal(second.content, "user text + AI");
  assert.equal(second.userEdited, true, "Undo must still protect user text");
  assert.equal(previewEdit({ ...next, content: "user text + AI + more" }, source, "r1", "two", second, baseline).userEdited, true);
  assert.throws(() => previewEdit(next, source, "r1", "two", { ...first, content: "new typing" }, baseline), /직접|변경/);
  assert.throws(() => previewEdit(next, source, "r1", "two", { ...second, content: "new typing" }, baseline), /직접|변경/);
  assert.throws(() => previewEdit(next, source, "r2", "two", first, baseline), /외부/);
});
test("flushing typed text can refresh its disk revision without changing the request's text baseline", () => {
  const baseline = { ...source, content: "typed before send" };
  const saved = { ...baseline, revision: "r2" };
  const next = { id: "p", kind: "edit", path: source.path, target: { vaultId: "v", path: source.path, original: baseline.content, before: baseline.content, from: 0, to: baseline.content.length }, content: baseline.content + " + AI" };
  const draft = previewEdit(next, saved, "r2", "request", undefined, baseline);
  assert.equal(draft.content, "typed before send + AI");
  assert.equal(draft.original, baseline.content);
  assert.equal(draft.revision, "r2");
  assert.throws(() => previewEdit(next, saved, "r3", "request", undefined, baseline), /외부/);
});
