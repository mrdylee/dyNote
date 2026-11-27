import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
function messages(turns) {
  return turns.flatMap(t => [
    { id: t.id + "-user", requestId: t.id, role: "user", content: t.prompt, imageName: t.imageName, mode: t.mode, complete: true },
    { id: t.id, checkpoint: t.status === "done" ? t.id : null, role: "assistant", content: t.content || (t.status === "canceled" ? "중지된 응답" : "완료되지 않은 응답"), mode: t.mode, complete: t.status === "done" },
    ...(t.applied ? [{ id: t.id + "-applied", role: "assistant", mode: "agent", complete: true, content: t.applied }] : []),
  ]);
}

export class CopilotHistory {
  constructor(directory) { this.directory = directory; this.tail = Promise.resolve(); }
  run(vaultId, args) {
    const job = this.tail.then(() => this.execute(vaultId, args));
    this.tail = job.catch(() => {});
    return job;
  }
  async execute(vaultId, args) {
    const { action, chatId, requestId } = args;
    const directory = path.join(this.directory, vaultId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (action === "list") {
      const list = [];
      for (const name of await readdir(directory)) {
        if (!name.endsWith(".json") || !uuid.test(name.slice(0, -5))) continue;
        const chat = JSON.parse(await readFile(path.join(directory, name), "utf8"));
        if (chat.turns.length) list.push({ id: name.slice(0, -5), title: chat.turns[0].prompt.slice(0, 80), updated: chat.updated });
      }
      return list.sort((a, b) => b.updated - a.updated);
    }
    if (!uuid.test(chatId)) throw new Error("대화를 다시 선택해 주세요.");
    const file = path.join(directory, chatId + ".json");
    let chat;
    try { chat = JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if (error.code !== "ENOENT" || action !== "begin") throw error; chat = { turns: [] }; }
    if (action === "open") return messages(chat.turns);
    if (!uuid.test(requestId)) throw new Error("요청을 다시 선택해 주세요.");
    const index = chat.turns.findIndex(t => t.id === requestId), turn = chat.turns[index];
    if (!turn && action !== "begin") throw new Error("복원 지점이 변경되었습니다. 대화를 다시 열어 주세요.");
    let result;
    if (action === "begin") {
      if (turn) throw new Error("이미 저장된 요청입니다.");
      if (chat.turns.at(-1)?.id !== args.lastRequestId) throw new Error("대화가 변경되었습니다. 최근 대화에서 다시 열어 주세요.");
      chat.turns.push({ id: requestId, prompt: args.prompt, mode: args.mode, imageName: args.imageName });
    } else if (action === "discardUnsent") {
      if (turn.status) return;
      chat.turns.splice(index, 1);
    } else if (action === "finish") {
      turn.status = args.status; turn.content = args.content ?? "";
    } else if (action === "applied") {
      turn.applied = args.content;
    } else if (action === "rewind") {
      if (turn.status !== "done" || chat.turns.at(-1)?.id !== args.lastRequestId)
        throw new Error("대화가 변경되었습니다. 최근 대화에서 다시 열어 주세요.");
      chat.turns.splice(index + 1);
      result = messages(chat.turns);
    } else throw new Error("지원하지 않는 대화 작업입니다.");
    chat.updated = Date.now();
    const temp = file + "." + randomUUID();
    try { await writeFile(temp, JSON.stringify(chat), { mode: 0o600 }); await rename(temp, file); }
    finally { await rm(temp, { force: true }); }
    return result;
  }
}
