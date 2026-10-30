export function contextMenuTemplate(params, onFormat, onFonts) {
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
    { label: "서식", submenu: [["bold", "굵게"], ["italic", "기울임"], ["strike", "취소선"], ["code", "인라인 코드"]]
      .map(([id, label]) => ({ id: `format-${id}`, label, click: () => onFormat(id) })) },
  );
  template.push({ type: "separator" }, { id: "font-settings", label: "글꼴 설정…", click: onFonts });
  return template;
}
