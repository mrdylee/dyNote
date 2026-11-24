import { createHash, createPublicKey, randomUUID, sign, verify } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { runGit } from "../core/git-backup.mjs";

export const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value);

export class BridgeGit {
  constructor({ directory, remote, channel, privateKey, peerKey }) {
    Object.assign(this, { directory, remote, channel, privateKey, peerKey });
    this.ownKey = createPublicKey(privateKey);
  }

  async git(args, options) {
    if (!this.ready) {
      this.ready = (async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        await runGit(this.directory, ["init", "--quiet", "--bare"]);
      })().catch(error => { this.ready = null; throw error; });
    }
    await this.ready;
    return (await runGit(this.directory, ["-c", "http.followRedirects=false", ...args], options)).stdout.trimEnd();
  }

  ref(name) {
    if (name !== "request" && !(name.startsWith("job/") && uuid(name.slice(4)))) throw new Error("작업 ID를 확인해 주세요.");
    return "refs/heads/dynote-bridge/" + this.channel + "/" + name;
  }

  async read(name, own = false) {
    const ref = this.ref(name);
    const tip = await this.git(["ls-remote", "--heads", "--", this.remote, ref]);
    if (!tip) return null;
    const [oid, actualRef] = tip.split("\t");
    if (actualRef !== ref || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid)) throw new Error("Git 작업 참조가 올바르지 않습니다.");
    // Use the immutable advertised object even if the branch moves during fetch.
    const present = await runGit(this.directory, ["cat-file", "-e", oid + "^{commit}"], { allow: [0, 1, 128] });
    if (present.code) await this.git(["fetch", "--no-tags", "--no-recurse-submodules", "--", this.remote, ref]);
    const object = oid + ":packet.json";
    // One control byte can occupy six bytes in the JSON encoding of a 128 KiB answer.
    if (Number(await this.git(["cat-file", "-s", object])) > 800000) throw new Error("작업 데이터가 너무 큽니다.");
    const packet = JSON.parse(await this.git(["cat-file", "blob", object]));
    const key = own ? this.ownKey : this.peerKey;
    const bytes = Buffer.from(JSON.stringify(packet.data));
    if (!verify(null, bytes, key, Buffer.from(packet.signature, "base64")) ||
        packet.data.channel !== this.channel || packet.data.ref !== ref || packet.data.v !== 1)
      throw new Error("승인된 채널 서명을 확인할 수 없습니다.");
    return { oid, value: packet.data.value };
  }

  async write(name, value, parent = "") {
    const ref = this.ref(name);
    const data = { v: 1, channel: this.channel, ref, value };
    const signature = sign(null, Buffer.from(JSON.stringify(data)), this.privateKey).toString("base64");
    const blob = await this.git(["hash-object", "-w", "--stdin"], { input: JSON.stringify({ data, signature }) });
    const tree = await this.git(["mktree"], { input: "100644 blob " + blob + "\tpacket.json\n" });
    const oid = await this.git(["-c", "user.name=Dynote", "-c", "user.email=bridge@dynote.invalid",
      "commit-tree", "--no-gpg-sign", tree, ...(parent ? ["-p", parent] : []), "-m", "Dynote job " + randomUUID()]);
    // Both a matching old tip and our declared parent are required, including first claim.
    await this.git(["push", "--no-verify", "--porcelain", "--force-with-lease=" + ref + ":" + parent,
      "--", this.remote, oid + ":" + ref]);
    return oid;
  }
}
