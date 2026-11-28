import path from "node:path";
import { lstat, realpath } from "node:fs/promises";

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

// Use the SDK's local tools so command output and edit results reach the same turn.
export function configureProjectTools(options, { root, confirm, signal, emit }) {
  const shell = process.platform === "win32" ? "powershell" : "bash";
  const names = [shell, "view", "create", "edit"];
  options.workingDirectory = root;
  options.availableTools.push(...names);
  options.systemMessage.content = options.systemMessage.content.replace("No shell or external filesystem access is available.", "")
    + "\nFor code implementation use view, create and edit in the selected project, and " + shell
    + " for foreground builds/tests. Its working directory is " + JSON.stringify(root)
    + ". Project writes and commands require a user decision. Report actual tool results; respect declined actions. Keep Dynote note edits in the note tools.";
  const denied = reason => ({ permissionDecision: "deny", permissionDecisionReason: reason });
  options.hooks = {
    async onPreToolUse({ toolName, toolArgs }) {
      if (!names.includes(toolName)) return;
      try {
        signal.throwIfAborted();
        let args, review;
        if (toolName === shell) {
          if (typeof toolArgs.command !== "string" || !toolArgs.command.trim() || toolArgs.mode === "async" || toolArgs.detach)
            return denied("포그라운드 명령을 사용해 주세요.");
          args = { command: toolArgs.command, description: toolArgs.description, mode: "sync", initial_wait: 200 };
          review = { kind: "shell", command: args.command };
        } else {
          const file = await projectPath(root, toolArgs.path, toolName === "create");
          args = { path: file };
          if (toolName === "view" && toolArgs.view_range) args.view_range = toolArgs.view_range;
          if (toolName === "create") args.file_text = toolArgs.file_text;
          if (toolName === "edit") { args.old_str = toolArgs.old_str; args.new_str = toolArgs.new_str; }
          if (toolName !== "view") {
            const before = toolName === "create" ? "" : args.old_str;
            const after = toolName === "create" ? args.file_text : args.new_str;
            if (typeof before !== "string" || typeof after !== "string") return denied("코드 변경 내용을 확인해 주세요.");
            review = { kind: toolName, path: path.relative(root, file), before, after };
          }
        }
        signal.throwIfAborted();
        if (review && !await confirm({ ...review, root })) return denied("사용자가 승인하지 않았습니다.");
        signal.throwIfAborted();
        if (review && toolName !== shell) await projectPath(root, args.path, toolName === "create");
        if (toolName === shell && await realpath(root) !== root) return denied("프로젝트 폴더가 변경되었습니다.");
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
