import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function verifyGitHubLogin(app, dialog, root, profile) {
  await app.evaluate(async ({shell}, root) => {
    const originalFetch = globalThis.fetch, originalOpen = shell.openExternal;
    const {createHash} = process.getBuiltinModule("node:crypto");
    const repo = {id:71,full_name:"example/notebook",private:true,default_branch:"trunk",permissions:{push:true}};
    const fs = process.getBuiltinModule("node:fs/promises"), path = process.getBuiltinModule("node:path");
    const notePaths = (await fs.readdir(root,{recursive:true})).filter(name => name.endsWith(".md"));
    const docs = await Promise.all([...notePaths,"Received.md"].map(async localName => {
      const name = localName.split(path.sep).join("/");
      const bytes = name === "Received.md" ? Buffer.from("received via GitHub login\n") : await fs.readFile(path.join(root,localName));
      const sha = createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
      return {name,sha,bytes};
    }));
    let installed = false, attempt = 0, firstList = true;
    const slowList = Promise.withResolvers(), listStarted = Promise.withResolvers();
    globalThis.githubListRace = {started:listStarted.promise, release:slowList.resolve};
    shell.openExternal = async url => {
      if (url === "https://github.com/apps/dynote-note-sync/installations/new") installed = true;
      else if (url !== "https://github.com/login/device") throw new Error("Unexpected browser destination");
    };
    globalThis.fetch = async (url, options) => {
      const route = new URL(url).pathname;
      if (route === "/apps/dynote-note-sync") return Response.json({owner:{id:131228699},slug:"dynote-note-sync",client_id:"fixture"});
      if (route === "/login/device/code") {
        attempt++;
        return Response.json({device_code:String(attempt),user_code:"TEST-000"+attempt,expires_in:300,interval:1,verification_uri:"https://github.com/login/device"});
      }
      if (route === "/login/oauth/access_token") {
        const device = options.body.get("device_code");
        if (device === "1") return Response.json({error:"access_denied"},{status:400});
        if (device === "2") return Response.json({error:"authorization_pending"},{status:400});
        return Response.json({access_token:"test-only-access",refresh_token:"test-only-refresh",expires_in:3600,token_type:"bearer"});
      }
      if (options?.headers?.Authorization !== "Bearer test-only-access") return originalFetch(url, options);
      if (route === "/user/installations") return Response.json({total_count:installed ? 1 : 0, installations:installed ? [{id:18,permissions:{contents:"write"}}] : []});
      if (route === "/user/installations/18/repositories") {
        if (firstList) {
          firstList = false;
          listStarted.resolve();
          await slowList.promise;
          return Response.json({}, {status:503});
        }
        return Response.json({total_count:2,repositories:[repo, {...repo,id:72,full_name:"example/other"}]});
      }
      if (route === "/repos/example/notebook") return Response.json(repo);
      const git = "/repos/example/notebook/git/";
      if (route === git + "ref/heads/trunk") return Response.json({object:{sha:"a".repeat(40)}});
      if (route === git + "commits/" + "a".repeat(40)) return Response.json({tree:{sha:"b".repeat(40)}});
      if (route === git + "trees/" + "b".repeat(40)) return Response.json({tree:docs.map(d=>({path:d.name,sha:d.sha,size:d.bytes.length,type:"blob",mode:"100644"}))});
      const file = docs.find(d=>route === git + "blobs/" + d.sha);
      if (file) return Response.json({encoding:"base64",content:file.bytes.toString("base64")});
      throw new Error("Unexpected fixture request " + route);
    };
    globalThis.restoreNoteLoginFixture = () => {
      slowList.resolve(); delete globalThis.githubListRace;
      globalThis.fetch = originalFetch; shell.openExternal = originalOpen;
    };
  }, root);
  try {
    const login = dialog.getByRole("button",{name:"GitHub 로그인",exact:true});
    await login.click();
    await dialog.getByRole("alert").filter({hasText:"GitHub 로그인이 취소되었습니다."}).waitFor();
    await login.click();
    await dialog.getByText("TEST-0002",{exact:true}).waitFor();
    await dialog.getByRole("button",{name:"로그인 취소",exact:true}).click();
    assert.equal(await dialog.getByText("TEST-0002",{exact:true}).count(), 0);
    await login.click();
    await dialog.getByText("TEST-0003",{exact:true}).waitFor();
    await dialog.getByText("GitHub에서 Dynote가 동기화할 노트 저장소를 허용해 주세요.",{exact:true}).waitFor();
    await dialog.getByRole("button",{name:"GitHub에서 저장소 허용"}).click();
    await dialog.getByRole("button",{name:"목록 새로고침"}).click();
    await app.evaluate(() => globalThis.githubListRace.started);
    await dialog.evaluate(() => window.dispatchEvent(new Event("focus")));
    const picker = dialog.getByLabel("노트 저장소",{exact:true});
    await picker.waitFor();
    assert.equal(await picker.inputValue(), "");
    assert(await dialog.getByRole("button",{name:"선택한 저장소 연결"}).isDisabled());
    await app.evaluate(() => globalThis.githubListRace.release());
    await dialog.evaluate(async () => {
      await window.notes.snapshot({});
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.deepEqual(await dialog.getByRole("alert").allTextContents(), [], "an older refresh must not replace the current picker result with an error");
    await picker.selectOption("71");
    await dialog.getByRole("button",{name:"선택한 저장소 연결"}).click();
    await dialog.getByRole("status").filter({hasText:"동기화됨"}).waitFor();
    assert.equal(await readFile(path.join(root,"Received.md"),"utf8"),"received via GitHub login\n");
    const file = await readFile(path.join(profile,"git-backup.json"),"utf8");
    assert(!file.includes("test-only-access") && !file.includes("test-only-refresh"));
    const record = Object.values(JSON.parse(file)).find(r=>r.mode==="github-api");
    assert(record.encryptedLogin && record.branch === "trunk");
    await dialog.getByRole("button",{name:"이 기기 동기화 끄기"}).click();
    await dialog.getByRole("status").filter({hasText:"꺼짐"}).waitFor();
    const disconnected = Object.values(JSON.parse(await readFile(path.join(profile,"git-backup.json"),"utf8"))).find(r=>r.mode==="github-api");
    assert.equal(disconnected.enabled, false);
    assert(!disconnected.encryptedLogin && !disconnected.encryptedToken);
    console.log("PASS GitHub browser denial, cancel and retry, overlapping refresh, explicit repository choice, encrypted credentials, first receive and disconnect");
  } catch (error) {
    console.error("GitHub setup state", await dialog.getByRole("alert").allTextContents(), await dialog.getByRole("combobox").evaluateAll(nodes => nodes.map(node => node.labels[0]?.textContent)));
    throw error;
  } finally {
    await app.evaluate(() => { globalThis.restoreNoteLoginFixture(); delete globalThis.restoreNoteLoginFixture; });
  }
}
