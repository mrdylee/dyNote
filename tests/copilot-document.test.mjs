import test from "node:test";
import assert from "node:assert/strict";
import { conversationDocumentContent, conversationDocumentRequest, defaultDocumentPrompt, documentPrompt } from "../core/copilot-document.mjs";

const request = content => conversationDocumentRequest({ requestId: "fixture", vaultId: "personal", model: "model",
  source: { path: "Copilot Note/project/conversation.md", content }, template: defaultDocumentPrompt.text });

test("a long conversation is passed only as ordered, lossless parts of the current note", () => {
  const content = "가🙂\n".repeat(19000);
  const input = request(content);
  const parts = [input.context, ...input.references];
  assert.equal(parts.length, 3);
  assert.equal(parts.map(part => part.content).join(""), content);
  assert.ok(parts.every(part => Buffer.byteLength(part.content) <= 65536 && Buffer.from(part.content).toString() === part.content));
  assert.equal(input.mode, "chat");
  assert.equal(input.vaultAccess, false);
  assert.deepEqual(input.history, []);
});

test("invalid prompts and oversized source documents are rejected without truncation", () => {
  assert.throws(() => documentPrompt("  "), /프롬프트 내용/);
  assert.throws(() => documentPrompt("가".repeat(3000)), /너무 깁니다/);
  assert.throws(() => request("a".repeat(196609)), /192 KiB/);
  assert.throws(() => request("   "), /비어 있습니다/);
});

test("the original link comes after metadata and the title, before the draft body", () => {
  const heading = "---\r\ntags: review\r\n---\r\n# Report";
  const body = "```sh\r\nnpm test";
  const source = "Copilot Note/project/conversation.md";
  const link = "출처: [[Copilot%20Note/project/conversation.md|원본 Copilot 대화]]";
  assert.equal(conversationDocumentContent(`${heading}\r\n\r\n${body}`, source), `${heading}\r\n\r\n${link}\r\n\r\n${body}\r\n`);
  assert.equal(conversationDocumentContent("    indented code", source), `${link}\n\n    indented code\n`);
});
