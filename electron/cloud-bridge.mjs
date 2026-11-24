import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { digest, uuid } from "./bridge-git.mjs";
import { MAX_ANSWER } from "../core/copilot.mjs";

const lifetime = 10 * 60000;
const active = state => ["SUBMITTED", "QUEUED", "RUNNING"].includes(state);
const textFits = (value, size) => typeof value === "string" && !!value.trim() && Buffer.byteLength(value) <= size;

async function load(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function save(file, record) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + "." + randomUUID();
  await writeFile(temp, JSON.stringify(record), { mode: 0o600 });
  await rename(temp, file);
}

export class BridgeClient {
  constructor(git, file) {
    this.git = git;
    this.file = file;
    this.tail = Promise.resolve();
  }

  enqueue(action) {
    const result = this.tail.then(action);
    this.tail = result.catch(() => {});
    return result;
  }

  async view(vaultId) {
    const job = await load(this.file);
    if (!job || job.vaultId !== vaultId) return { state: job && active(job.state) ? "BUSY" : "IDLE" };
    return { state: job.state, requestId: job.request.id, prompt: job.request.prompt, answer: job.answer, lastChecked: job.lastChecked };
  }

  submit(vaultId, prompt) {
    return this.enqueue(async () => {
      if (!vaultId || !textFits(prompt, 8192)) throw new Error("질문을 8 KiB 이내로 입력해 주세요.");
      if (active((await load(this.file))?.state)) throw new Error("이전 Cloud 질문이 진행 중입니다.");
      const request = { id: randomUUID(), created: Date.now(), prompt: prompt.trim() };
      await save(this.file, { vaultId, state: "SUBMITTED", request });
      return this.view(vaultId);
    });
  }

  tick() {
    return this.enqueue(async () => {
      const job = await load(this.file);
      if (!job || !active(job.state)) return;
      const request = job.request;
      const result = await this.git.read("job/" + request.id);
      if (result) {
        const value = result.value;
        if (value.id !== request.id || value.requestDigest !== digest(request) ||
            !["RUNNING", "COMPLETED", "FAILED"].includes(value.state) ||
            !Number.isSafeInteger(value.at) || value.at < request.created - 60000 ||
            (value.state === "COMPLETED" && !textFits(value.answer, MAX_ANSWER)))
          throw new Error("응답이 원래 질문과 일치하지 않습니다.");
        if (value.at <= request.created + lifetime) {
          job.state = value.state;
          if (value.state === "COMPLETED") job.answer = value.answer;
        }
      }
      if (active(job.state) && Date.now() >= request.created + lifetime) {
        job.state = "TIMEOUT";
      } else if (job.state === "SUBMITTED") {
        const old = await this.git.read("request", true);
        if (old?.value.id === request.id) {
          if (digest(old.value) !== digest(request)) throw new Error("같은 요청 ID의 내용이 다릅니다.");
        } else {
          await this.git.write("request", request, old?.oid);
        }
        job.state = "QUEUED";
      }
      job.lastChecked = Date.now();
      await save(this.file, job);
    });
  }
}

export class BridgeWorker {
  constructor(git, file, ask) {
    Object.assign(this, { git, file, ask });
  }

  async publish(pending) {
    const name = "job/" + pending.result.id;
    const tip = await this.git.read(name, true);
    if (tip?.oid === pending.claim) await this.git.write(name, pending.result, pending.claim);
    else if (!tip || digest(tip.value) !== digest(pending.result)) throw new Error("Cloud 실행 기록이 변경되었습니다.");
    await save(this.file, null);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const pending = await load(this.file);
      if (pending) return await this.publish(pending);
      const latest = await this.git.read("request");
      if (!latest) return;
      const request = latest.value;
      if (!uuid(request?.id) || !textFits(request.prompt, 8192) || !Number.isSafeInteger(request.created) ||
          request.created > Date.now() + 60000 || Object.keys(request).sort().join(",") !== "created,id,prompt")
        throw new Error("유효하지 않은 Cloud 질문입니다.");
      if (Date.now() >= request.created + lifetime) return;
      const name = "job/" + request.id;
      if (await this.git.read(name, true)) return;
      const receipt = { id: request.id, requestDigest: digest(request), state: "RUNNING", at: Date.now() };
      const claim = await this.git.write(name, receipt);
      // A restart after this point must never repeat a possibly billed request.
      let answer;
      try {
        if (Date.now() < request.created + lifetime) answer = await this.ask(request.prompt, request.id);
      } catch { /* Only the signed failure code crosses the transport. */ }
      const at = Date.now();
      const result = textFits(answer, MAX_ANSWER) && at <= request.created + lifetime
        ? { ...receipt, at, state: "COMPLETED", answer } : { ...receipt, at, state: "FAILED" };
      const completed = { claim, result };
      await save(this.file, completed);
      await this.publish(completed);
    } finally { this.running = false; }
  }
}
