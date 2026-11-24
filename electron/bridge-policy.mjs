import path from "node:path";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { BridgeGit, digest, uuid } from "./bridge-git.mjs";
import { BridgeClient, BridgeWorker } from "./cloud-bridge.mjs";
import { BridgeRepositories } from "./bridge-repositories.mjs";
import { validateGitConfig } from "../core/git-backup.mjs";

function windowsProgramData() {
  const koffi = createRequire(import.meta.url)("koffi");
  const locate = koffi.load("shell32.dll").func("int32_t __stdcall SHGetKnownFolderPath(const void *, uint32_t, void *, _Out_ void **)");
  const free = koffi.load("ole32.dll").func("void __stdcall CoTaskMemFree(void *)");
  // FOLDERID_ProgramData in Windows GUID byte order.
  const folderId = Buffer.from("825dab62c1fdc34da9dd070d1d495d97", "hex");
  const output = [null];
  try {
    if (locate(folderId, 0, null, output) !== 0 || !output[0]) return null;
    return koffi.decode.string16(output[0]);
  } finally { if (output[0]) free(output[0]); }
}

export function managedBridgePath(platform = process.platform, getProgramData = windowsProgramData) {
  if (platform === "win32") {
    try {
      const root = getProgramData();
      return root && path.win32.isAbsolute(root) ? path.win32.join(root, "Dynote", "cloud-bridge.json") : null;
    } catch { return null; }
  }
  if (platform === "darwin") return "/Library/Application Support/Dynote/cloud-bridge.json";
  return "/etc/dynote/cloud-bridge.json";
}

export async function openBridge(file, dataRoot, ask, getNoteRemotes = async () => []) {
  if (!file) return { role: "blocked", error: "Windows의 공용 관리 설정 위치를 확인할 수 없습니다." };
  let bytes;
  try { bytes = await readFile(file, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    return { role: "blocked", error: "Cloud Bridge 관리 설정을 읽을 수 없습니다." };
  }
  try {
    const policy = JSON.parse(bytes);
    if (!["client", "worker"].includes(policy.role) || !uuid(policy.channel) ||
        !path.isAbsolute(policy.privateKeyFile) || !path.isAbsolute(policy.peerPublicKeyFile)) throw new Error();
    const extra = policy.additionalRemotes ?? [];
    if (!Array.isArray(extra)) throw new Error();
    const remotes = [...new Set([policy.remote, ...extra].map(address => {
      const { remote } = validateGitConfig({ remote: address, branch: "main" });
      if (!remote.startsWith("https://")) throw new Error();
      return remote;
    }))];
    const privateKey = createPrivateKey(await readFile(policy.privateKeyFile));
    const peerKey = createPublicKey(await readFile(policy.peerPublicKeyFile));
    if ([privateKey, peerKey].some(key => key.asymmetricKeyType !== "ed25519") || createPublicKey(privateKey).equals(peerKey)) throw new Error();
    const keyId = key => key.export({ format: "der", type: "spki" }).toString("base64");
    const keys = [keyId(createPublicKey(privateKey)), keyId(peerKey)];
    const root = path.join(dataRoot, "cloud-bridge", policy.role);
    if (policy.role === "worker" && (typeof policy.model !== "string" || !policy.model.trim() || policy.model.length > 200 ||
        typeof policy.copilotLogin !== "string" || !policy.copilotLogin.trim())) throw new Error();
    const createService = remote => {
      const directory = path.join(root, digest([policy.channel, remote, ...keys]));
      const git = new BridgeGit({ directory: path.join(directory, "cache.git"), remote, channel: policy.channel, privateKey, peerKey,
        repositoryScope: remote === remotes[0] ? undefined : digest(remote) });
      return policy.role === "client" ? new BridgeClient(git, path.join(directory, "last-question.json"))
        : new BridgeWorker(git, path.join(directory, "pending-result.json"), (prompt, requestId, deadline) =>
          ask({ prompt, requestId, deadline, model: policy.model, login: policy.copilotLogin }));
    };
    return await new BridgeRepositories({ role: policy.role, remotes, getNoteRemotes, createService,
      file: path.join(root, digest([policy.channel, ...keys]) + ".json") }).open();
  } catch {
    return { role: "blocked", error: "Cloud Bridge의 관리 설정 또는 역할 서명 키를 확인해 주세요." };
  }
}
