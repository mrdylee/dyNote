import test from "node:test";
import assert from "node:assert/strict";
import { GitHubLogin } from "../core/github-login.mjs";

const clientId = "Iv1.test-example";
const row = (id, name, branch, push = true) => ({ id, full_name: name, default_branch: branch, private: true, permissions: { push } });
const noteRepo = row(48, "writer/notes", "trunk");

function fixture(answers = []) {
  let now = 1000;
  const opened = [], requests = [];
  const fetcher = async (url, options) => {
    if (url === "https://api.github.com/apps/dynote-note-sync")
      return Response.json({client_id:clientId,slug:"dynote-note-sync",owner:{id:131228699}});
    const call = { url, ...options };
    requests.push(call);
    const response = answers.shift();
    assert(response, "unexpected request " + url);
    return Response.json(typeof response === "function" ? await response(call) : response);
  };
  const login = new GitHubLogin({ fetcher, now: () => now, openExternal: async url => opened.push(url) });
  return { login, opened, requests, advance: ms => { now += ms; } };
}

const challenge = { device_code: "private-device", user_code: "ABCD-EFGH", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 };
const grant = { access_token: "private-access", refresh_token: "private-refresh", expires_in: 28800, token_type: "bearer" };

test("browser login respects the polling interval and slow-down and keeps credentials out of the UI", async () => {
  const { login, opened, requests, advance } = fixture([challenge, { error:"slow_down" }, { error:"authorization_pending" }, grant]);
  const start = await login.start();
  assert.equal(start.userCode, "ABCD-EFGH");
  assert.deepEqual(opened, ["https://github.com/login/device"]);
  assert(!JSON.stringify(start).includes("private-"));
  assert.equal((await login.poll(start.id)).waitMs, 5000);
  assert.equal(requests.length, 1);
  advance(5000);
  assert.equal((await login.poll(start.id)).waitMs, 10000);
  advance(10000);
  assert.equal((await login.poll(start.id)).waitMs, 10000);
  advance(10000);
  assert.deepEqual(await login.poll(start.id), {authorized:true});
  assert.equal(requests[0].url, "https://github.com/login/device/code");
  assert.equal(requests[3].url, "https://github.com/login/oauth/access_token");
  assert.equal(new URLSearchParams(requests[3].body).get("device_code"), challenge.device_code);
});

test("cancel, expiry and a denied grant end login without connecting", async () => {
  const { login, requests, advance } = fixture([challenge, challenge, challenge, {error:"access_denied"}]);
  const first = await login.start();
  login.cancel(first.id);
  await assert.rejects(login.poll(first.id), /다시/);
  const second = await login.start();
  advance(901000);
  await assert.rejects(login.poll(second.id), /만료/);
  const third = await login.start();
  advance(5000);
  await assert.rejects(login.poll(third.id), /취소/);
  await assert.rejects(login.repositories(third.id), /다시/);
  assert.equal(requests.length, 4);
});

test("repository selection only offers writable installed repositories and resolves its current default branch", async () => {
  const hidden = row(49, "writer/readonly", "main", false);
  const { login, requests, advance } = fixture([challenge, grant,
    {total_count:1, installations:[{id:7,permissions:{contents:"write"}}]},
    {total_count:3, repositories:[hidden, {...hidden,id:50,archived:true}, noteRepo]},
    {...noteRepo,default_branch:"dev"},
  ]);
  const start = await login.start();
  advance(5000);
  await login.poll(start.id);
  const repos = await login.repositories(start.id);
  assert.deepEqual(repos, [{id:48, name:"writer/notes", branch:"trunk", private:true}]);
  await assert.rejects(login.select(start.id,49), /목록/);
  const chosen = await login.select(start.id,48);
  assert.equal(chosen.config.branch,"dev");
  assert.equal(chosen.config.remote,"https://github.com/writer/notes.git");
  assert.equal(chosen.credentials.accessToken,grant.access_token);
  assert(requests.slice(2).every(r => r.headers.Authorization === "Bearer " + grant.access_token));
  assert(requests[2].url.startsWith("https://api.github.com/user/installations?"));
  assert(requests[3].url.startsWith("https://api.github.com/user/installations/7/repositories?"));
});

test("a device-flow grant rotates with its refresh token and no client secret", async () => {
  const { login, requests } = fixture([{...grant,access_token:"rotated",refresh_token:"new-refresh"}]);
  const old = {clientId,accessToken:"old",refreshToken:"old-refresh",expiresAt:1000};
  const fresh = await login.refresh(old);
  assert.equal(fresh.accessToken,"rotated");
  assert.equal(fresh.refreshToken,"new-refresh");
  assert.equal(await login.refresh(fresh),fresh);
  assert.equal(requests.length,1);
  const form = new URLSearchParams(requests[0].body);
  assert.equal(form.get("grant_type"),"refresh_token");
  assert.equal(form.get("refresh_token"),"old-refresh");
  assert.equal(form.has("client_secret"),false);
});

test("the picker includes writable repositories after the first hundred and omits suspended installations", async () => {
  const readOnly = Array.from({length:100}, (_,i)=>row(i+100, "writer/readonly"+i, "main", false));
  const {login, advance, requests} = fixture([challenge,grant,
    {total_count:2, installations:[{id:1,suspended_at:"today",permissions:{contents:"write"}},{id:2,permissions:{contents:"write"}}]},
    {total_count:101,repositories:readOnly}, {total_count:101,repositories:[noteRepo]}]);
  const {id} = await login.start(); advance(5000); await login.poll(id);
  assert.deepEqual((await login.repositories(id)).map(r=>r.name),["writer/notes"]);
  assert(requests.at(-1).url.endsWith("/2/repositories?per_page=100&page=2"));
});

test("a late authorization cannot revive a cancelled device login", async () => {
  let finish;
  const {login,advance} = fixture([challenge,()=>new Promise(resolve=>{finish=resolve;})]);
  const {id} = await login.start(); advance(5000);
  const pending = login.poll(id);
  login.cancel(id); finish(grant);
  await assert.rejects(pending,/다시/);
  await assert.rejects(login.repositories(id),/다시/);
});
