import { createHash, randomUUID } from "node:crypto";
import { validateGitConfig } from "./git-backup.mjs";
import { validPersonalFilePath } from "./vault.mjs";
import { blobLimit } from "./personal-sync-store.mjs";

export const blobSha = (bytes) =>
  createHash("sha1")
    .update("blob " + bytes.length + "\0")
    .update(bytes)
    .digest("hex");
export function apiConfig(input) {
  const { remote, branch } = validateGitConfig(input);
  const match = /^https:\/\/github\.com\/([\w-]+)\/([\w.-]+?)\/?$/i.exec(remote);
  const repo = match?.[2].replace(/\.git$/i, "");
  if (!repo || /^\.+$/.test(repo)) throw new Error("GitHub.com 저장소의 HTTPS 주소를 입력해 주세요.");
  return { mode: "github-api", remote: "https://github.com/" + match[1] + "/" + repo + ".git", branch };
}

function oid(value) {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error("GitHub 파일 버전을 확인하지 못했습니다.");
  return value;
}
export class GitHubRemote {
  constructor(config, token, fetcher) {
    this.url = "https://api.github.com/repos/" + config.remote.slice("https://github.com/".length, -4);
    this.branch = config.branch;
    this.ref = "heads/" + this.branch.split("/").map(encodeURIComponent).join("/");
    this.token = token;
    this.fetcher = fetcher;
  }
  async request(route, method = "GET", body, onResponse) {
    const response = await this.fetcher(this.url + route, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: "Bearer " + this.token,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const hint = [401, 403, 404].includes(response.status)
        ? "저장소 주소·브랜치·토큰의 Contents 권한을 확인해 주세요."
        : "브랜치 보호 규칙과 연결 상태를 확인해 주세요.";
      throw Object.assign(new Error("GitHub 요청 실패 (" + response.status + "). " + hint), {
        status: response.status,
      });
    }
    onResponse?.(response);
    return response.json();
  }
  async head() {
    try {
      return oid((await this.request("/git/ref/" + this.ref)).object.sha);
    } catch (error) {
      if (![404, 409].includes(error.status)) throw error;
      const repo = await this.request("");
      if (repo.default_branch !== this.branch || (await this.request("/branches?per_page=1")).length) throw error;
      return null;
    }
  }
  async contains(commit, head) {
    if (commit === head) return true;
    if (!head) return false;
    try {
      return (await this.request("/compare/" + oid(commit) + "..." + oid(head))).status === "ahead";
    } catch (error) {
      if (error.status === 404) return false;
      throw error;
    }
  }
  async findSeed(seed, head) {
    if (!head) return null;
    const route = "/commits?sha=" + oid(head) + "&path=" + encodeURIComponent(seed.name) + "&per_page=100";
    const readPage = async (page) => {
      let next, last;
      const rows = await this.request(route + "&page=" + page, "GET", undefined, response => {
        for (const [, url, relation] of (response.headers.get("link") ?? "").matchAll(/<([^>]+)>;\s*rel="(next|last)"/gi)) {
          const number = Number(new URL(url).searchParams.get("page"));
          if (relation.toLowerCase() === "next") {
            if (!Number.isSafeInteger(number) || number <= page) throw new Error("GitHub 커밋 이력 페이지를 확인하지 못했습니다.");
            next = number;
          } else if (Number.isSafeInteger(number) && number > page) last = number;
        }
      });
      return { candidate: rows.find(row => row.commit.message === seed.message), next, last };
    };
    const first = await readPage(1);
    let candidate = first.candidate, next = first.next;
    // The initial upload normally introduced this path. Check its oldest page before the intervening edits.
    const checkLast = first.last && first.last !== first.next;
    if (!candidate && checkLast) candidate = (await readPage(first.last)).candidate;
    while (!candidate && next && (!checkLast || next !== first.last)) {
      const page = await readPage(next);
      candidate = page.candidate;
      next = page.next;
    }
    if (!candidate) return null;
    const sha = oid(candidate.sha);
    return (await this.snapshot(sha)).files.get(seed.name) === seed.sha ? sha : null;
  }
  async snapshot(head, previous) {
    if (previous && head !== previous) {
      if (!head || (await this.request("/compare/" + oid(previous) + "..." + head)).status !== "ahead")
        throw new Error("원격 브랜치 이력이 변경되었습니다. 두 보관함을 확인해 주세요.");
    }
    if (!head) return { tree: null, files: new Map(), entries: [] };
    const tree = oid((await this.request("/git/commits/" + head)).tree.sha);
    const result = await this.request("/git/trees/" + tree + "?recursive=1");
    if (result.truncated || !Array.isArray(result.tree))
      throw new Error("파일 목록이 불완전해 동기화를 멈췄습니다.");
    const files = new Map();
    for (const row of result.tree) {
      if (!validPersonalFilePath(row.path) || row.type === "tree") continue;
      if (row.type !== "blob" || !["100644", "100755"].includes(row.mode) || row.size > blobLimit)
        throw new Error("동기화할 수 없는 파일입니다: " + row.path);
      files.set(row.path, oid(row.sha));
    }
    return { tree, files, entries: result.tree };
  }
  async download(sha) {
    const result = await this.request("/git/blobs/" + oid(sha));
    const bytes = Buffer.from(result.content, "base64");
    if (result.encoding !== "base64" || bytes.length > blobLimit || blobSha(bytes) !== sha)
      throw new Error("GitHub에서 받은 파일의 내용이 버전과 일치하지 않습니다.");
    return bytes;
  }
  async publish(head, snapshot, updates, read, beforeRefUpdate) {
    const message = "Dynote 개인 노트 동기화";
    if (!head) {
      // GitHub cannot create a Git reference in an empty repository. Seed with a real note.
      const [name, sha] = updates.entries().next().value;
      const content = (await read(name, sha)).toString("base64");
      const seed = { name, sha, message: message + "\n\nDynote-Seed: " + randomUUID() };
      await beforeRefUpdate?.({ seed });
      const created = await this.request("/contents/" + name.split("/").map(encodeURIComponent).join("/"), "PUT", {
        message: seed.message,
        content,
        branch: this.branch,
      });
      return oid(created.commit.sha);
    }
    const entries = new Map(snapshot.entries.map((row) => [row.path, row]));
    const tree = [];
    let inlineBytes = 0;
    for (const [name, sha] of updates) {
      const parts = name.split("/");
      for (let i = 1; i < parts.length; i++) {
        const parent = entries.get(parts.slice(0, i).join("/"));
        if (parent && parent.type !== "tree") throw new Error("GitHub 폴더와 파일 경로가 겹칩니다: " + name);
      }
      const old = entries.get(name);
      if (old && old.type !== "blob") throw new Error("GitHub 파일 경로를 확인해 주세요: " + name);
      if (sha) {
        const bytes = await read(name, sha);
        // Batch small UTF-8 documents in the tree request. Binary blobs keep their exact bytes.
        if (/\.(md|canvas|base|html?)$/i.test(name) && inlineBytes + bytes.length <= 1024 * 1024) {
          const content = bytes.toString("utf8");
          if (Buffer.from(content).equals(bytes)) {
            inlineBytes += bytes.length;
            tree.push({ path: name, mode: old?.mode || "100644", type: "blob", content });
            continue;
          }
        }
        const uploaded = await this.request("/git/blobs", "POST", {
          content: bytes.toString("base64"),
          encoding: "base64",
        });
        if (oid(uploaded.sha) !== sha) throw new Error("업로드한 파일 버전을 확인하지 못했습니다.");
      }
      tree.push({ path: name, mode: old?.mode || "100644", type: "blob", sha });
    }
    const created = await this.request("/git/trees", "POST", { base_tree: snapshot.tree, tree });
    const commit = await this.request("/git/commits", "POST", {
      message,
      tree: oid(created.sha),
      parents: [head],
    });
    const sha = oid(commit.sha);
    await beforeRefUpdate?.({ head: sha });
    await this.request("/git/refs/" + this.ref, "PATCH", { sha, force: false });
    return sha;
  }
}
