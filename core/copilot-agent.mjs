import { randomUUID } from "node:crypto";
import { validNotePath } from "./vault.mjs";
import { MAX_ANSWER } from "./copilot.mjs";

// These tools read bounded snapshots or stage drafts. Only the renderer's
// reviewed apply action writes through the existing vault/revision API.
export function noteTools({ args, getNotes, emit, canceled }) {
  const supplied = new Map(args.references.map((note) => [note.path, note]));
  if (args.context.path) supplied.set(args.context.path, args.context);
  const read = new Map(), proposed = new Set();
  let snapshot, calls = 0, readBytes = 0, draftBytes = 0;
  const active = () => { if (canceled()) throw new Error("요청이 중지되었습니다."); };
  const pathOf = (path) => {
    if (typeof path !== "string" || path.length > 2048 || !validNotePath(path)) throw new Error("허용되지 않는 Markdown 경로입니다.");
    return path;
  };
  const notes = async () => {
    active();
    if (!args.vaultAccess) return [...supplied.values()];
    snapshot ??= Promise.resolve(getNotes(args.vaultId));
    const disk = await snapshot;
    active();
    return [...new Map([...disk, ...supplied.values()].map((note) => [note.path, note])).values()];
  };
  const tool = (name, description, properties, required, handler) => ({
    name: `dynote_${name}`, description, defer: "never", skipPermission: true,
    parameters: { type: "object", properties, required, additionalProperties: false },
    handler: async (input) => {
      try {
        active();
        if (++calls > 24) throw new Error("도구 사용 한도에 도달했습니다. 범위를 줄여 다시 요청해 주세요.");
        if (!input || typeof input !== "object") throw new Error("잘못된 도구 입력입니다.");
        const result = await handler(input);
        active();
        return { resultType: "success", textResultForLlm: JSON.stringify(result) };
      } catch (error) {
        return { resultType: "failure", textResultForLlm: String(error.message).slice(0, 500) };
      }
    },
  });
  const stage = (kind, path, content, target) => {
    active();
    if (typeof content !== "string" || !content.trim() || Buffer.byteLength(content) > MAX_ANSWER) throw new Error("수정안은 비어 있지 않은 128 KiB 이내의 Markdown이어야 합니다.");
    if (proposed.has(path)) throw new Error("이 문서는 이미 수정안을 만들었습니다. 다음 요청에서 다시 수정해 주세요.");
    if (proposed.size >= 5 || draftBytes + Buffer.byteLength(content) > 262144) throw new Error("한 요청의 수정안 한도에 도달했습니다.");
    draftBytes += Buffer.byteLength(content);
    proposed.add(path);
    const proposal = { id: randomUUID(), kind, path, content, ...(target ? { target } : {}) };
    emit("proposal", { proposal });
    emit("tool", { message: `${kind === "create" ? "새 문서" : "수정안"} 준비 · ${path}` });
    return { path, status: "awaiting_user_review", saved: false };
  };
  const pathSchema = { type: "string", description: "Vault-relative Markdown path, e.g. Projects/Plan.md" };
  return [
    tool("read_note", "Read the current unsaved document/selection, an attached note, or an allowed vault note. Required before edit_note.", { path: pathSchema }, ["path"], async ({ path }) => {
      pathOf(path);
      const note = supplied.get(path) ?? (await notes()).find((n) => n.path === path);
      if (!note) throw new Error("읽을 수 없는 문서입니다. 문서를 첨부하거나 보관함 검색을 허용해 주세요.");
      const size = Buffer.byteLength(note.content);
      if (size > 65536 || readBytes + size > 262144) throw new Error("읽기 범위가 너무 큽니다. 문서 또는 선택 영역을 줄여 주세요.");
      readBytes += size;
      read.set(path, note);
      emit("tool", { message: `읽음 · ${path}${note.kind === "selection" ? " (선택 영역만)" : ""}` });
      return { path, content: note.content, scope: note.kind === "selection" ? "selection" : "document" };
    }),
    tool("search_notes", "Search permitted notes by literal filename or text; at most 20 snippets. Vault search requires the user's vault-access option.", { query: { type: "string", maxLength: 200 } }, ["query"], async ({ query }) => {
      if (typeof query !== "string" || !query.trim() || query.length > 200) throw new Error("검색어는 1~200자로 입력해 주세요.");
      const needle = query.toLocaleLowerCase(), matches = [];
      for (const note of await notes()) {
        const at = note.content.toLocaleLowerCase().indexOf(needle);
        if (at >= 0 || note.path.toLocaleLowerCase().includes(needle))
          matches.push({ path: note.path, excerpt: note.content.slice(Math.max(0, at - 80), Math.max(0, at - 80) + 240) });
        if (matches.length === 20) break;
      }
      emit("tool", { message: `검색 · ${query} · ${matches.length}개 (최대 20개)` });
      return { matches, limit: 20 };
    }),
    tool("edit_note", "Stage a reviewed change to a previously read note. replace supplies the complete replacement; append/prepend adds content to the supplied scope. Does not save.", {
      path: pathSchema, operation: { type: "string", enum: ["replace", "append", "prepend"] }, content: { type: "string" },
    }, ["path", "operation", "content"], ({ path, operation, content }) => {
      pathOf(path);
      const note = read.get(path);
      if (!note) throw new Error("수정 전에 read_note로 현재 내용을 읽어 주세요.");
      if (!["replace", "append", "prepend"].includes(operation) || typeof content !== "string") throw new Error("잘못된 수정 작업입니다.");
      const replacement = operation === "append" ? note.content + content : operation === "prepend" ? content + note.content : content;
      return stage("edit", path, replacement, { vaultId: args.vaultId, path, original: note.content, from: 0, to: note.content.length, before: note.content });
    }),
    tool("create_note", "Stage a new Markdown note for user review. The user chooses Apply to create it. Existing files will never be overwritten.", {
      path: pathSchema, content: { type: "string" },
    }, ["path", "content"], ({ path, content }) => {
      pathOf(path);
      if (supplied.has(path) || read.has(path)) throw new Error("기존 문서는 edit_note로 수정해 주세요.");
      return stage("create", path, content);
    }),
  ];
}
