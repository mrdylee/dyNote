import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { digest, uuid } from "./bridge-git.mjs";
import { MAX_ANSWER } from "../core/copilot.mjs";

const lifetime = 10 * 60000;
const active = state => ["SUBMITTED", "QUEUED", "RUNNING"].includes(state);
const textFits = (value, size) => typeof value === "string" && !!value.trim() && Buffer.byteLength(value) <= size;

function clientState(job) {
  if (active(job?.state) && Date.now() >= job.request.created + lifetime) return "TIMEOUT";
  return job?.state;
}

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
    const state = clientState(job);
    if (!job || job.vaultId !== vaultId) return { state: active(state) ? "BUSY" : "IDLE" };
    return { state, awaitingConfirmation: state !== job.state, requestId: job.request.id,
      prompt: job.request.prompt, answer: job.answer, reason: job.reason, lastChecked: job.lastChecked };
  }

  submit(vaultId, prompt) {
    return this.enqueue(async () => {
      if (!vaultId || !textFits(prompt, 8192)) throw new Error("질문을 8 KiB 이내로 입력해 주세요.");
      if (active(clientState(await load(this.file)))) throw new Error("이전 Cloud 질문이 진행 중입니다.");
      const request = { id: randomUUID(), created: Date.now(), prompt: prompt.trim() };
      await save(this.file, { vaultId, state: "SUBMITTED", request });
      return this.view(vaultId);
    });
  }

  tick() {
    return this.enqueue(async () => {
      const job = await load(this.file);
      if (job && active(job.state)) await this.update(job);
    });
  }

  recheck(vaultId, requestId) {
    return this.enqueue(async () => {
      const job = await load(this.file);
      if (!job || job.vaultId !== vaultId || job.request.id !== requestId || clientState(job) !== "TIMEOUT")
        throw new Error("다시 확인할 질문을 선택해 주세요.");
      await this.update(job);
      return this.view(vaultId);
    });
  }

  async update(job) {
    const request = job.request;
    const deadline = request.created + lifetime;
    const result = await this.git.read("job/" + request.id);
    if (result) {
      const value = result.value;
      if (value.id !== request.id || value.requestDigest !== digest(request) ||
          !["RUNNING", "COMPLETED", "FAILED"].includes(value.state) ||
          !Number.isSafeInteger(value.at) || value.at < request.created - 60000 ||
          (value.state === "COMPLETED" && !textFits(value.answer, MAX_ANSWER)))
        throw new Error("응답이 원래 질문과 일치하지 않습니다.");
      if (value.at <= deadline && (job.state !== "TIMEOUT" || value.state !== "RUNNING")) {
        job.state = value.state;
        if (value.state === "COMPLETED") job.answer = value.answer;
        if (value.state === "FAILED" && value.reason === "OUTCOME_UNKNOWN") job.reason = value.reason;
      }
    }
    if (job.state === "SUBMITTED" && Date.now() < deadline) {
      const old = await this.git.read("request", true);
      if (old?.value.id === request.id) {
        if (digest(old.value) !== digest(request)) throw new Error("같은 요청 ID의 내용이 다릅니다.");
      } else if (Date.now() < deadline) {
        await this.git.write("request", request, old?.oid);
      }
      job.state = "QUEUED";
    }
    job.state = clientState(job);
    job.lastChecked = Date.now();
    await save(this.file, job);
  }
}

export class BridgeWorker {
  constructor(git, file, ask) {
    Object.assign(this, { git, file, ask });
  }

  async readRequest() {
    const latest = await this.git.read("request");
    if (!latest) return null;
    const request = latest.value;
    if (!uuid(request?.id) || !textFits(request.prompt, 8192) || !Number.isSafeInteger(request.created) ||
        request.created > Date.now() + 60000 || Object.keys(request).sort().join(",") !== "created,id,prompt")
      throw new Error("유효하지 않은 Cloud 질문입니다.");
    return request;
  }

  retiredFile(id) {
    return this.file + "." + id + ".retired";
  }

  async publish(pending) {
    const name = "job/" + pending.result.id;
    const tip = await this.git.read(name, true);
    if (tip?.oid === pending.claim) await this.git.write(name, pending.result, pending.claim);
    else if (!tip || digest(tip.value) !== digest(pending.result)) {
      const next = await this.readRequest();
      if (!next || next.id === pending.result.id || Date.now() >= next.created + lifetime)
        throw new Error("Cloud 실행 기록이 변경되었습니다.");
      // Keep the result and its request ID together if the old claim was retired.
      await rename(this.file, this.retiredFile(pending.result.id));
      return;
    }
    await save(this.file, null);
  }

  async execute({ request, receipt }) {
    const deadline = request.created + lifetime;
    const name = "job/" + request.id;
    const tip = await this.git.read(name, true);
    if ((tip && digest(tip.value) !== digest(receipt)) || Date.now() >= deadline) {
      await save(this.file, null);
      return;
    }
    const claim = tip?.oid ?? await this.git.write(name, receipt);
    // From here a restart publishes uncertainty instead of repeating a possibly billed call.
    await save(this.file, { claim, result: { ...receipt, state: "FAILED", reason: "OUTCOME_UNKNOWN" } });
    let answer;
    try {
      if (Date.now() < deadline) answer = await this.ask(request.prompt, request.id, deadline);
    } catch { /* Only the signed failure code crosses the transport. */ }
    const at = Date.now();
    const result = textFits(answer, MAX_ANSWER) && at <= deadline
      ? { ...receipt, at, state: "COMPLETED", answer } : { ...receipt, at, state: "FAILED" };
    const completed = { claim, result };
    await save(this.file, completed);
    await this.publish(completed);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const pending = await load(this.file);
      if (pending?.result) return await this.publish(pending);
      const request = await this.readRequest();
      if (!request) return;
      if (pending?.receipt?.requestDigest === digest(request))
        return await this.execute({ request, receipt: pending.receipt });
      if (pending) await save(this.file, null);
      if (Date.now() >= request.created + lifetime) return;
      const name = "job/" + request.id;
      if (await this.git.read(name, true) || await load(this.retiredFile(request.id))) return;
      const receipt = { id: request.id, requestDigest: digest(request), claimId: randomUUID(), state: "RUNNING", at: Date.now() };
      await save(this.file, { receipt });
      await this.execute({ request, receipt });
    } finally { this.running = false; }
  }
}
