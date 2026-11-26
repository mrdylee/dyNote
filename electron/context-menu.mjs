import { textSizeOptions } from "../core/text-size-options.mjs";

export function contextMenuTemplate(params, onFormat, onFonts, onSync, onReveal) {
  const flags = params.editFlags ?? {};
  const editor = params.isEditable && params.formControlType === "none";
  const edit = (role, label, enabled) => ({ role, label, enabled: Boolean(enabled) });
  const template = [
    editor ? { id: "editor-undo", label: "실행 취소", enabled: true, click: () => onFormat("undo") } : edit("undo", "실행 취소", params.isEditable && flags.canUndo),
    editor ? { id: "editor-redo", label: "다시 실행", enabled: true, click: () => onFormat("redo") } : edit("redo", "다시 실행", params.isEditable && flags.canRedo),
    { type: "separator" },
    edit("cut", "잘라내기", params.isEditable && flags.canCut),
    edit("copy", "복사", flags.canCopy),
    edit("paste", "붙여넣기", params.isEditable && flags.canPaste),
    edit("selectAll", "모두 선택", flags.canSelectAll),
  ];
  if (editor) template.push(
    { type: "separator" },
    { id: "format-bullet-list", label: "불릿으로 전환", click: () => onFormat("bullet-list") },
    { id: "format-paragraph", label: "일반 문단으로 전환", click: () => onFormat("paragraph") },
    { label: "서식", submenu: [["bold", "굵게"], ["italic", "기울임"], ["strike", "취소선"], ["code", "인라인 코드"],
      ...textSizeOptions.map(({ id, label }) => [id, label]), ["apply-color", "글자 색상 적용"], ["clear-color", "기본색"]]
      .map(([id, label]) => ({ id: `format-${id}`, label, click: () => onFormat(id) })) },
  );
  template.push({ type: "separator" }, { id: "font-settings", label: "글꼴 설정…", click: onFonts });
  template.push({ id: "sync-vault", label: "지금 동기화", click: onSync });
  if (onReveal) template.push({ id: "reveal-file", label: "파일 위치 열기", click: onReveal });
  return template;
}
