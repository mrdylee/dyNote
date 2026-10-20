import { applyProposal } from "../core/copilot.mjs";

export function previewEdit(proposal, source, diskRevision, requestId, previous) {
  if (previous?.userEdited) throw new Error("직접 편집하여 AI 추가 반영을 중지했습니다.");
  if (proposal.kind === "create") {
    if (source || diskRevision) throw new Error("같은 이름의 문서가 이미 존재합니다.");
  } else {
    if (!source || (previous && previous.revision !== diskRevision) || (!previous && source.revision !== diskRevision))
      throw new Error("외부에서 문서가 변경되었습니다. 초안을 확인해 주세요.");
  }
  const content = proposal.kind === "create" ? proposal.content : applyProposal(proposal.target, { ...source, vaultId: proposal.target.vaultId }, proposal.content);
  return { id: proposal.id, requestId, path: proposal.path, kind: proposal.kind,
    original: previous?.original ?? source?.content ?? "", revision: previous?.revision ?? diskRevision,
    content, aiContent: content, userEdited: false, conflict: "" };
}

export function overlayNotes(notes, drafts) {
  const replacements = new Map(drafts.map((draft) => [draft.path, draft]));
  return [...notes.map((note) => replacements.has(note.path) ? { ...note, content: replacements.get(note.path).content } : note),
    ...drafts.filter((draft) => !notes.some((note) => note.path === draft.path)).map((draft) => ({ path: draft.path, content: draft.content, revision: draft.revision }))];
}

export function changedRange(before, after) {
  if (before === after) return null;
  let from = 0, end = 0;
  while (from < before.length && from < after.length && before[from] === after[from]) from++;
  while (end < before.length - from && end < after.length - from && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return { from, to: after.length - end };
}
