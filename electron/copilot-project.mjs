import path from "node:path";
import { randomUUID } from "node:crypto";
import { publishFile } from "../core/publish-file.mjs";
import { lstat, realpath, mkdir, readFile, writeFile, chmod, rename, rm } from "node:fs/promises";

async function projectPath(root, input, creating) {
  if (typeof input !== "string" || !input.trim()) throw new Error("프로젝트 파일 경로를 확인해 주세요.");
  const file = path.resolve(root, input);
  const relative = path.relative(root, file);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative) || await realpath(root) !== root)
    throw new Error("선택한 프로젝트 안의 경로를 사용해 주세요.");
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error("링크를 통해 프로젝트 파일에 접근할 수 없습니다.");
    } catch (e) { if (e.code !== "ENOENT" || !creating) throw e; }
  }
  return file;
}

// File tools are host-defined because Auto can remove SDK edit/create tools
// after choosing the model for a turn.
const editing = new Set();
function projectWriteTool(kind, root, confirm, signal, emit) {
  const creating = kind === "create";
  const fields = creating ? ["path", "file_text"] : ["path", "old_str", "new_str"];
  return {
    name: "dynote_project_" + kind, defer: "never", skipPermission: true,
    description: creating ? "Create a UTF-8 project file after user review." : "Replace one exact, unique text match in a UTF-8 project file after user review.",
    parameters: { type: "object", properties: Object.fromEntries(fields.map(field => [field, { type: "string" }])), required: fields, additionalProperties: false },
    async handler(args) {
      let locked, temp;
      try {
        signal.throwIfAborted();
        if (!fields.every(field => typeof args?.[field] === "string")) throw new Error("파일과 변경 내용을 확인해 주세요.");
        const file = await projectPath(root, args.path, creating);
        if (editing.has(file)) throw new Error("같은 파일의 변경 확인이 진행 중입니다.");
        editing.add(file); locked = file;
        const before = creating ? "" : args.old_str, after = creating ? args.file_text : args.new_str;
        let content = after, original, mode;
        const stat = await lstat(file).catch(e => { if (e.code !== "ENOENT") throw e; return null; });
        if (creating) {
          if (stat) throw new Error("이미 존재하는 파일입니다.");
        } else {
          if (!stat?.isFile() || stat.size > 8 * 1024 * 1024) throw new Error("8 MiB 이하의 텍스트 파일을 선택해 주세요.");
          original = await readFile(file);
          const text = original.toString("utf8"), index = text.indexOf(before);
          if (!Buffer.from(text).equals(original) || text.includes("\0") || !before || index < 0 || index !== text.lastIndexOf(before))
            throw new Error("파일을 다시 읽고 한 곳만 일치하는 텍스트를 지정해 주세요.");
          content = text.slice(0, index) + after + text.slice(index + before.length);
          mode = stat.mode & 0o777;
        }
        if (Buffer.byteLength(content) > 8 * 1024 * 1024) throw new Error("변경할 파일은 8 MiB 이하여야 합니다.");
        const relative = path.relative(root, file);
        if (!await confirm({ kind, root, path: relative, before, after })) return { resultType: "denied", textResultForLlm: "사용자가 승인하지 않았습니다." };
        signal.throwIfAborted();
        await projectPath(root, file, creating);
        if (creating) await mkdir(path.dirname(file), { recursive: true });
        temp = path.join(path.dirname(file), ".dynote-" + randomUUID() + ".tmp");
        await writeFile(temp, content, { flag: "wx", mode: 0o600 });
        if (!creating) await chmod(temp, mode);
        await projectPath(root, file, creating);
        if (!creating && !(await readFile(file)).equals(original)) throw new Error("승인 대기 중 파일 내용이 변경되었습니다.");
        signal.throwIfAborted();
        if (creating) await publishFile(temp, file);
        else await rename(temp, file);
        emit("tool", { message: "코드 적용 · " + relative });
        return { resultType: "success", textResultForLlm: "Saved " + relative };
      } catch (error) {
        return { resultType: "failure", textResultForLlm: error.message };
      } finally {
        if (locked) editing.delete(locked);
        if (temp) await rm(temp, { force: true });
      }
    },
  };
}

export function configureProjectTools(options, { root, confirm, signal, emit }) {
  const shell = process.platform === "win32" ? "powershell" : "bash";
  const writes = ["edit", "create"].map(kind => projectWriteTool(kind, root, confirm, signal, emit));
  options.tools.push(...writes);
  options.workingDirectory = root;
  options.availableTools.push(shell, "view", ...writes.map(tool => tool.name));
  options.systemMessage.content = options.systemMessage.content
    .replace("No shell or external filesystem access is available.", "")
    .replace("Never claim a file was saved.", "Report a note as a pending draft until the user saves it.")
    + "\nFor code implementation use view, dynote_project_create and dynote_project_edit in the selected project, and " + shell
    + " for foreground builds/tests. Its working directory is " + JSON.stringify(root)
    + ". Project files are separate from note drafts: use dynote_project_create or dynote_project_edit to actually implement requested changes, then run the requested verification after the write succeeds. "
    + "Each write and command asks the user for approval through the tool itself. If a write tool is unavailable or fails, explain that explicitly. Report actual tool results; respect declined actions.";
  const denied = reason => ({ permissionDecision: "deny", permissionDecisionReason: reason });
  options.hooks = {
    async onPreToolUse({ toolName, toolArgs }) {
      if (toolName !== shell && toolName !== "view") return;
      try {
        signal.throwIfAborted();
        if (toolName === "view") {
          const file = await projectPath(root, toolArgs.path, false);
          signal.throwIfAborted();
          return { permissionDecision: "allow", modifiedArgs: { ...toolArgs, path: file } };
        }
        if (typeof toolArgs.command !== "string" || !toolArgs.command.trim() || toolArgs.mode === "async" || toolArgs.detach)
          return denied("포그라운드 명령을 사용해 주세요.");
        const args = { command: toolArgs.command, description: toolArgs.description, mode: "sync", initial_wait: 200 };
        if (!await confirm({ kind: "shell", command: args.command, root })) return denied("사용자가 승인하지 않았습니다.");
        signal.throwIfAborted();
        if (await realpath(root) !== root) return denied("프로젝트 폴더가 변경되었습니다.");
        return { permissionDecision: "allow", modifiedArgs: args };
      } catch (error) { return denied(error.message); }
    },
    onPostToolUseFailure({ toolName, toolArgs, error }) {
      if (!signal.aborted && toolName === shell) emit("tool", { message: toolArgs.command + "\n" + String(error).slice(-8000) });
    },
    onPostToolUse({ toolName, toolArgs, toolResult }) {
      if (!signal.aborted && toolName === shell) emit("tool", { message: toolArgs.command + "\n" + String(toolResult.textResultForLlm ?? "").slice(-8000) });
    },
  };
}
