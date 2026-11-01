import { readFile, writeFile, rename, mkdir, realpath, stat, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const object = value => value && typeof value === "object" && !Array.isArray(value);
const text = (value, max = 4096) => typeof value === "string" && value.length <= max && !value.includes("\0");
const strings = value => Array.isArray(value) && value.length <= 100 && value.every(item => text(item));
const fields = value => object(value) && Object.keys(value).length <= 100 && Object.entries(value).every(([key, item]) => text(key, 200) && text(item, 32768));
const absolute = value => text(value) && path.isAbsolute(value);

async function jsonFile(file, limit) {
  const info = await stat(file);
  if (!info.isFile() || info.size > limit) throw new Error("file");
  const data = await readFile(file);
  if (data.length > limit) throw new Error("size");
  return JSON.parse(data.toString("utf8"));
}

async function readMcp(file) {
  try {
    const data = await jsonFile(file, 262144);
    if (!object(data?.mcpServers) || Object.keys(data.mcpServers).length > 32) throw new Error("servers");
    const servers = [];
    for (const [name, value] of Object.entries(data.mcpServers)) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(name) || ["__proto__", "constructor", "prototype"].includes(name) || !object(value)) throw new Error("name");
      if (value.enabled === false || value.disabled === true) continue;
      const type = value.type === "stdio" ? "local" : value.type ?? (value.command ? "local" : "http");
      if (value.tools !== undefined && !strings(value.tools)) throw new Error("tools");
      const tools = value.tools ?? ["*"];
      if (type === "local") {
        if (!text(value.command) || !value.command.trim() || value.url !== undefined ||
            (value.args !== undefined && !strings(value.args)) || (value.env !== undefined && !fields(value.env)) ||
            (value.cwd !== undefined && !text(value.cwd))) throw new Error("local");
        servers.push([name, { type, command: value.command.startsWith(".") ? path.resolve(path.dirname(file), value.command) : value.command,
          args: value.args ?? [], cwd: path.resolve(path.dirname(file), value.cwd ?? "."), tools,
          ...(value.env ? { env: value.env } : {}) }]);
      } else if (["http", "sse"].includes(type)) {
        if (!text(value.url) || value.command !== undefined || (value.headers !== undefined && !fields(value.headers))) throw new Error("remote");
        const url = new URL(value.url);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("url");
        servers.push([name, { type, url: url.href, tools, ...(value.headers ? { headers: value.headers } : {}) }]);
      } else throw new Error("transport");
    }
    return servers;
  } catch { throw new Error(`MCP 설정 파일을 확인해 주세요: ${path.basename(file)}`); }
}

export class AiExtensions {
  constructor({ file }) { this.file = file; this.configs = []; this.skillDirectories = []; this.pending = Promise.resolve(); this.failure = ""; }
  async load() {
    try {
      const data = await jsonFile(this.file, 65536);
      if (!Array.isArray(data.configs) || data.configs.length > 16 || !data.configs.every(absolute) ||
          !Array.isArray(data.skillDirectories) || data.skillDirectories.length > 32 || !data.skillDirectories.every(absolute)) throw new Error("settings");
      this.configs = [...new Set(data.configs)]; this.skillDirectories = [...new Set(data.skillDirectories)];
    } catch (error) {
      if (error.code !== "ENOENT") { this.failure = "AI 확장 설정을 읽지 못했습니다. 기존 설정 파일을 확인해 주세요."; throw new Error(this.failure); }
    }
  }
  async collect(configs = this.configs, skillDirectories = this.skillDirectories) {
    const servers = new Map(), errors = this.failure ? [this.failure] : [];
    for (const file of configs) {
      try {
        for (const [name, server] of await readMcp(file)) {
          if (servers.has(name)) throw new Error(`MCP 서버 이름이 중복됩니다: ${name}`);
          servers.set(name, server);
        }
      } catch (error) { errors.push(error.message); }
    }
    for (const directory of skillDirectories) {
      try { if (!(await stat(directory)).isDirectory()) throw new Error("directory"); }
      catch { errors.push(`스킬 폴더를 확인해 주세요: ${path.basename(directory)}`); }
    }
    return { mcpServers: Object.fromEntries(servers), skillDirectories: [...skillDirectories], errors };
  }
  async getExtensions() {
    const { errors, ...extensions } = await this.collect();
    if (errors.length) throw new Error(errors.join("\n"));
    return extensions;
  }
  async snapshot() {
    const result = await this.collect();
    return { configs: this.configs.map(file => ({ path: file, name: path.basename(file) })),
      skillDirectories: [...this.skillDirectories], servers: Object.entries(result.mcpServers).map(([name, server]) => ({ name, transport: server.type })), errors: result.errors };
  }
  change(action) {
    const result = this.pending.then(() => { if (this.failure) throw new Error(this.failure); return action(); });
    this.pending = result.catch(() => {}); return result;
  }
  async save(configs, skillDirectories) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ configs, skillDirectories }), { mode: 0o600 });
      await rename(temporary, this.file);
    } catch (error) { await rm(temporary, { force: true }); throw error; }
    this.configs = configs; this.skillDirectories = skillDirectories;
    return this.snapshot();
  }
  addConfig(file) {
    return this.change(async () => {
      if (!absolute(file)) throw new Error("MCP 설정의 절대 경로를 확인해 주세요.");
      const canonical = await realpath(file), configs = [...new Set([...this.configs, canonical])];
      if (configs.length > 16) throw new Error("MCP 설정 파일은 16개까지 연결할 수 있습니다.");
      const result = await this.collect(configs);
      if (result.errors.length) throw new Error(result.errors.join("\n"));
      return this.save(configs, this.skillDirectories);
    });
  }
  addSkills(directory) {
    return this.change(async () => {
      if (!absolute(directory)) throw new Error("스킬 폴더의 절대 경로를 확인해 주세요.");
      const canonical = await realpath(directory);
      if (!(await stat(canonical)).isDirectory()) throw new Error("스킬 폴더를 선택해 주세요.");
      const skillDirectories = [...new Set([...this.skillDirectories, canonical])];
      if (skillDirectories.length > 32) throw new Error("스킬 폴더는 32개까지 연결할 수 있습니다.");
      return this.save(this.configs, skillDirectories);
    });
  }
  remove(args) {
    return this.change(() => {
      if (!args || !["config", "skills"].includes(args.kind) || !absolute(args.path)) throw new Error("제거할 AI 확장을 확인해 주세요.");
      return this.save(this.configs.filter(file => args.kind !== "config" || file !== args.path), this.skillDirectories.filter(directory => args.kind !== "skills" || directory !== args.path));
    });
  }
}
