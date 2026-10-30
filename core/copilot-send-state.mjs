import { captureContext } from "./copilot.mjs";

export function defaultCopilotModel(models, current) {
  return models.some(model => model.id === current) ? current : models.find(model => model.id === "auto")?.id ?? "";
}

export function sendBlock({ connection, model, prompt, checking, authBusy, busy, applying, running, vaultId, note, scope, selection, mode, ready, blocked }) {
  const reason = (code, message) => ({ code, message });
  if (checking) return reason("checking", "Copilot 연결 상태를 확인하고 있습니다.");
  if (authBusy) return reason("authBusy", "GitHub 연결을 마치거나 로그인 취소를 눌러 주세요.");
  if (!connection.authenticated) return reason("auth", "GitHub Copilot에 연결해 주세요.");
  if (!vaultId) return reason("vault", "노트 폴더를 열어 현재 노트를 불러와 주세요.");
  if (running) return reason("running", "응답을 기다리거나 중지한 뒤 다시 보낼 수 있습니다.");
  if (busy) return reason("busy", "노트 저장 작업이 끝나면 보낼 수 있습니다.");
  if (applying) return reason("applying", "수정안을 적용하고 있습니다.");
  if (mode !== "chat" && blocked) return reason("drafts", "미확정 AI 변경을 유지하거나 되돌려 주세요. Ask에서는 현재 노트로 대화할 수 있습니다.");
  if (mode !== "chat" && !ready) return reason("ready", "AI 복구 초안을 확인해 주세요. Ask에서는 현재 노트로 대화할 수 있습니다.");
  if (!connection.models.some(item => item.id === model)) return reason("model", connection.error || (connection.models.length ? "AI 모델을 선택해 주세요." : "사용 가능한 AI 모델을 확인해 주세요. 연결 상태를 다시 확인할 수 있습니다."));
  try { captureContext({ vaultId, note, scope, selection }); }
  catch (error) { return reason("context", scope === "document" && !note ? "현재 노트가 없습니다. 왼쪽에서 Markdown 노트를 열어 주세요." : error.message); }
  if (!prompt.trim()) return reason("prompt", "질문을 입력해 주세요.");
  return null;
}
