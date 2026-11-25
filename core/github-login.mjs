import { randomUUID } from "node:crypto";
import { apiConfig } from "./github-remote.mjs";

const api = "https://api.github.com";
const slug = "dynote-note-sync";
const ownerId = 131228699; // Publisher of mrdylee/dyNote.
const devicePage = "https://github.com/login/device";
export const githubInstallPage = "https://github.com/apps/" + slug + "/installations/new";
const loginAgain = () => new Error("GitHub 로그인을 다시 시작해 주세요.");

function credentials(result, clientId, now) {
  if (typeof result.access_token !== "string" || !result.access_token || result.token_type?.toLowerCase() !== "bearer") throw loginAgain();
  if (result.expires_in != null && (!(result.expires_in > 0) || !result.refresh_token)) throw loginAgain();
  return {clientId, accessToken:result.access_token, refreshToken:result.refresh_token ?? null,
    expiresAt:result.expires_in ? now + result.expires_in * 1000 : null};
}

function writable(row) {
  return Number.isSafeInteger(row.id) && /^[\w.-]+\/[\w.-]+$/.test(row.full_name) &&
    typeof row.default_branch === "string" && row.default_branch && row.permissions?.push === true && !row.archived && !row.disabled;
}

export class GitHubLogin {
  constructor({fetcher = fetch, openExternal, now = Date.now}) {
    Object.assign(this, {fetcher, openExternal, now});
  }
  async json(url, options) {
    const response = await this.fetcher(url, {...options, redirect:"error", signal:AbortSignal.timeout(30000)});
    if (response.status === 401) throw loginAgain();
    if (!response.ok) throw new Error("GitHub 연결을 확인해 주세요 (HTTP " + response.status + ").");
    return response.json();
  }
  async oauth(endpoint, fields) {
    return this.json("https://github.com/login/" + endpoint, {
      method:"POST", headers:{Accept:"application/json"}, body:new URLSearchParams(fields),
    });
  }
  async start() {
    const session = this.session = {id:randomUUID(), repos:new Map()};
    try {
      if (!this.clientId) {
        const app = await this.json(api + "/apps/" + slug, {headers:{Accept:"application/vnd.github+json"}});
        if (app.owner?.id !== ownerId || app.slug !== slug || !app.client_id) throw new Error("Dynote의 GitHub 앱 등록 정보를 확인할 수 없습니다.");
        this.clientId = app.client_id;
      }
      const auth = await this.oauth("device/code", {client_id:this.clientId});
      if (auth.verification_uri !== devicePage || !auth.device_code || !auth.user_code || !(auth.expires_in > 0))
        throw new Error("GitHub 기기 로그인을 시작할 수 없습니다. 다시 시도해 주세요.");
      this.current(session.id);
      const interval = Math.max(1, Number(auth.interval) || 5) * 1000;
      Object.assign(session, {deviceCode:auth.device_code, interval, next:this.now()+interval, expiresAt:this.now()+auth.expires_in*1000});
      await this.openExternal(devicePage);
      this.current(session.id);
      return {id:session.id, userCode:auth.user_code, waitMs:interval};
    } catch (error) {
      this.cancel(session.id);
      throw error;
    }
  }
  current(id) {
    if (!id || this.session?.id !== id) throw loginAgain();
    return this.session;
  }
  cancel(id) {
    if (this.session?.id === id) this.session = null;
  }
  async poll(id) {
    const s = this.current(id);
    if (s.credentials) return {authorized:true};
    if (this.now() >= s.expiresAt) { this.cancel(id); throw new Error("인증 코드가 만료되었습니다. GitHub 로그인을 다시 시작해 주세요."); }
    const waitMs = s.next - this.now();
    if (waitMs > 0) return {waitMs};
    s.next = this.now() + s.interval;
    const result = await this.oauth("oauth/access_token", {client_id:this.clientId, device_code:s.deviceCode, grant_type:"urn:ietf:params:oauth:grant-type:device_code"});
    this.current(id);
    if (result.error === "authorization_pending" || result.error === "slow_down") {
      if (result.error === "slow_down") s.interval = Math.max(s.interval + 5000, (Number(result.interval) || 0) * 1000);
      s.next = this.now() + s.interval;
      return {waitMs:s.interval};
    }
    if (result.error) {
      this.cancel(id);
      if (result.error === "access_denied") throw new Error("GitHub 로그인이 취소되었습니다.");
      if (result.error === "expired_token") throw new Error("인증 코드가 만료되었습니다. 다시 로그인해 주세요.");
      throw loginAgain();
    }
    s.credentials = credentials(result, this.clientId, this.now());
    delete s.deviceCode;
    return {authorized:true};
  }
  async refresh(saved) {
    if (saved.expiresAt == null || this.now() + 60000 < saved.expiresAt) return saved;
    if (!saved.refreshToken) throw loginAgain();
    const result = await this.oauth("oauth/access_token", {client_id:saved.clientId, grant_type:"refresh_token", refresh_token:saved.refreshToken});
    return credentials(result, saved.clientId, this.now());
  }
  async get(s, route) {
    this.current(s.id);
    if (!s.credentials) throw loginAgain();
    const result = await this.json(api + route, {headers:{Accept:"application/vnd.github+json", Authorization:"Bearer " + s.credentials.accessToken}});
    this.current(s.id);
    return result;
  }
  async pages(s, route, field) {
    const rows = [];
    for (let page = 1; ; page++) {
      const result = await this.get(s, route + "?per_page=100&page=" + page);
      rows.push(...result[field]);
      if (result[field].length < 100 || rows.length >= result.total_count) return rows;
    }
  }
  async repositories(id) {
    const s = this.current(id), repos = new Map();
    const installations = await this.pages(s, "/user/installations", "installations");
    for (const installation of installations) {
      if (!Number.isSafeInteger(installation.id) || installation.suspended_at || installation.permissions?.contents !== "write") continue;
      const rows = await this.pages(s, "/user/installations/" + installation.id + "/repositories", "repositories");
      for (const row of rows) {
        if (writable(row)) repos.set(row.id, {id:row.id, name:row.full_name, branch:row.default_branch, private:row.private === true});
      }
    }
    this.current(id).repos = repos;
    return [...repos.values()].sort((a,b) => a.name.localeCompare(b.name));
  }
  async select(id, repositoryId) {
    const s = this.current(id), repo = s.repos.get(repositoryId);
    if (!repo) throw new Error("목록에서 노트 저장소를 다시 선택해 주세요.");
    const row = await this.get(s, "/repos/" + repo.name);
    if (row.id !== repositoryId || !writable(row)) throw new Error("저장소 쓰기 권한을 확인하고 목록을 새로고침해 주세요.");
    const config = apiConfig({remote:"https://github.com/" + row.full_name, branch:row.default_branch});
    return {config, credentials:s.credentials};
  }
}
