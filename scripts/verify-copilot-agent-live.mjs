// Opt-in account-backed inference using ONLY synthetic note text; no vault files.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { CopilotController } from "../electron/copilot-controller.mjs";
const directory = process.env.DYNOTE_LIVE_COPILOT_DIRECTORY;
if (!directory) throw new Error("Set DYNOTE_LIVE_COPILOT_DIRECTORY to the existing connected profile explicitly.");
const events = [];
const controller = new CopilotController({ directory, openExternal() { throw new Error("Interactive authentication is outside this probe."); }, onEvent: (event) => events.push(event) });
try {
  const status = await controller.status();
  assert.equal(status.authenticated, true, "An already connected account is required.");
  const model = status.models.find((m) => m.id === "auto") ?? status.models[0];
  assert.ok(model);
  controller.send({
    requestId: "live-agent-probe", vaultId: "synthetic-only", model: model.id, mode: "agent", history: [],
    context: { kind: "document", path: "Synthetic probe.md", content: "# 연동 검증\n기존 내용 유지" },
    prompt: "현재 문서를 read_note로 읽고, edit_note append로 줄바꿈 다음에 '- [ ] 연결 확인' 한 줄만 추가하는 수정안을 준비해 줘. 실제 저장되었다고 말하지 마. 답변은 짧게 해 줘.",
  });
  await controller.settled();
  const done = events.find((event) => event.type === "done");
  assert.ok(done, events.find((event) => event.type === "error")?.error ?? "No completion");
  const proposal = events.find((event) => event.type === "proposal")?.proposal;
  assert.ok(proposal, "The model must use the note-writing tool.");
  assert.equal(proposal.kind, "edit");
  assert.ok(proposal.content.startsWith("# 연동 검증\n기존 내용 유지"));
  assert.match(proposal.content, /연결 확인/);
  const report = { model: model.id, liveModelVerified: true, syntheticContextOnly: true, modelReadAndDrafted: true, vaultFilesWritten: false };
  await writeFile("docs/verification/copilot-agent-live.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally { await controller.close(); }
