import { prepareRequest } from "./copilot.mjs";

const encoder = new TextEncoder();
const partLimit = 64 * 1024;
const instruction = "현재 문서와 참고 조각은 같은 대화의 연속된 원문입니다. 제공된 내용만 근거로 새 정보 문서의 Markdown 본문만 작성해 주세요.";

export const defaultDocumentPrompt = {
  id: "default",
  name: "기본",
  text: "질문과 답변을 주제별로 통합해 하나의 정보 문서로 작성해 주세요. 제목과 핵심 내용을 먼저 쓰고, 대화에 있는 결정 사항, 실행 절차, 남은 질문을 구분해 주세요. 반복되는 설명을 줄이고 다시 사용할 코드, 명령어, 수치와 조건은 정확히 보존해 주세요. 추정이나 미확인 내용은 사실과 구분해 주세요.",
};

export function documentPrompt(text) {
  const template = text.trim();
  if (!template) throw new Error("프롬프트 내용을 입력해 주세요.");
  const prompt = `${instruction}\n\n${template}`;
  if (encoder.encode(prompt).length > 8192) throw new Error("프롬프트가 너무 깁니다. 내용을 줄여 주세요.");
  return prompt;
}

export function conversationDocumentRequest({ requestId, vaultId, model, reasoningEffort, source, template }) {
  if (!source.content.trim()) throw new Error("대화 내용이 비어 있습니다.");
  const size = encoder.encode(source.content).length;
  const sizeError = "약 192 KiB까지 정리할 수 있습니다. 대화를 더 작은 문서로 나눠 주세요.";
  if (size > partLimit * 3) throw new Error(sizeError);
  const parts = [];
  let start = 0, end = 0, bytes = 0;
  if (size > partLimit) {
    for (const character of source.content) {
      const code = character.codePointAt(0);
      const width = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      if (bytes + width > partLimit) {
        parts.push(source.content.slice(start, end));
        start = end;
        bytes = 0;
      }
      end += character.length;
      bytes += width;
    }
  }
  parts.push(source.content.slice(start));
  if (size > partLimit && size - encoder.encode(parts[0]).length > partLimit * 2) throw new Error(sizeError);
  return prepareRequest({ requestId, vaultId, model, reasoningEffort, mode: "chat",
    prompt: documentPrompt(template), context: { kind: "document", path: source.path, content: parts[0] },
    references: parts.slice(1).map((content, index) => ({ path: `${source.path} (${index + 2}/${parts.length})`, content })),
    history: [], vaultAccess: false });
}
