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
    if (response instanceof Response) return response;
    return Response.json(typeof response === "function" ? await response(call) : response);
  };
  const login = new GitHubLogin({ fetcher, now: () => now, openExternal: async url => opened.push(url) });
  return { login, opened, requests, advance: ms => { now += ms; } };
}

const challenge = { device_code: "private-device", user_code: "ABCD-EFGH", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 };
const grant = { access_token: "private-access", refresh_token: "private-refresh", expires_in: 28800, token_type: "bearer" };

function installationPage(...ids) {
  return {total_count:ids.length, installations:ids.map(id => ({id, permissions:{contents:"write"}}))};
}

function repositoryPage(...repositories) {
  return {total_count:repositories.length, repositories};
}

async function authorized(...answers) {
  const setup = fixture([challenge, grant, ...answers]);
  const {id, waitMs} = await setup.login.start();
  setup.advance(waitMs);
  assert.deepEqual(await setup.login.poll(id), {authorized:true});
  return {...setup, id};
}

function delayedResponse() {
  const started = Promise.withResolvers(), result = Promise.withResolvers();
  return {
    read() { started.resolve(); return result.promise; },
    started:started.promise, finish:result.resolve,
  };
}

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

test("a pending device grant sent as an OAuth HTTP 400 continues polling", async () => {
  const {login, advance} = fixture([challenge, Response.json({error:"authorization_pending"},{status:400}), grant]);
  const {id} = await login.start();
  advance(5000);
  assert.equal((await login.poll(id)).waitMs,5000);
  advance(5000);
  assert.deepEqual(await login.poll(id),{authorized:true});
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

test("an older repository refresh cannot restore a repository removed by a newer refresh", async () => {
  const earlierPage = delayedResponse();
  const added = row(91, "writer/other-notes", "main");
  const {login, id} = await authorized(
    installationPage(7), earlierPage.read,
    installationPage(7), repositoryPage(added),
    ({url}) => url.endsWith("/" + noteRepo.full_name) ? noteRepo : added,
  );
  const earlier = login.repositories(id);
  await earlierPage.started;
  assert.deepEqual((await login.repositories(id)).map(repo => repo.id), [added.id]);
  earlierPage.finish(repositoryPage(noteRepo));
  const [oldResult] = await Promise.allSettled([earlier]);
  await assert.rejects(login.select(id, noteRepo.id), /목록에서/);
  assert.equal((await login.select(id, added.id)).config.remote, "https://github.com/writer/other-notes.git");
  assert.equal(oldResult.status, "rejected");
  assert.match(oldResult.reason.message, /목록/);
});

test("an older refresh cannot publish its choices after the newer refresh fails", async () => {
  const earlierPage = delayedResponse();
  const {login, id} = await authorized(
    installationPage(7), earlierPage.read,
    Response.json({message:"Service Unavailable"}, {status:503}),
  );
  const earlier = login.repositories(id);
  await earlierPage.started;
  await assert.rejects(login.repositories(id), /HTTP 503/);
  earlierPage.finish(repositoryPage(noteRepo));
  await assert.rejects(earlier, /목록/);
  await assert.rejects(login.select(id, noteRepo.id), /목록에서/);
});

test("an in-flight selection loses eligibility when the app installation is removed", async () => {
  const details = delayedResponse();
  const {login, id} = await authorized(installationPage(7), repositoryPage(noteRepo), details.read, installationPage());
  await login.repositories(id);
  const selection = login.select(id, noteRepo.id);
  await details.started;
  assert.deepEqual(await login.repositories(id), []);
  details.finish(noteRepo);
  await assert.rejects(selection, /목록/);
});

for (const [change, installation, updated] of [
  ["a repository transfer", 8, row(noteRepo.id, "new-owner/moved-notes", noteRepo.default_branch)],
  ["a default branch change", 7, {...noteRepo, default_branch:"new-default"}],
]) {
  test("an in-flight selection cannot save the old destination after " + change, async () => {
    const details = delayedResponse();
    const {login, id} = await authorized(
      installationPage(7), repositoryPage(noteRepo), details.read,
      installationPage(installation), repositoryPage(updated), updated,
    );
    await login.repositories(id);
    const selection = login.select(id, noteRepo.id);
    await details.started;
    const [fresh] = await login.repositories(id);
    assert.deepEqual([fresh.name, fresh.branch], [updated.full_name, updated.default_branch]);
    details.finish(noteRepo);
    await assert.rejects(selection, /목록/);
    assert.deepEqual((await login.select(id, fresh.id)).config, {
      mode:"github-api", remote:"https://github.com/" + updated.full_name + ".git", branch:updated.default_branch,
    });
  });
}

test("a refresh that retains the selected destination allows the user's connection to finish", async () => {
  const details = delayedResponse();
  const {login, id} = await authorized(
    installationPage(7), repositoryPage(noteRepo), details.read,
    installationPage(7), repositoryPage(noteRepo, row(90, "writer/other", "main")),
  );
  await login.repositories(id);
  const selection = login.select(id, noteRepo.id);
  await details.started;
  await login.repositories(id);
  details.finish({...noteRepo, default_branch:"latest"});
  assert.equal((await selection).config.branch, "latest");
});

for (const [change, updated] of [
  ["repository name", {...noteRepo, full_name:"writer/renamed"}],
  ["default branch", {...noteRepo, default_branch:"release/notes"}],
]) {
  test("a selection succeeds when both GitHub responses confirm the same new " + change, async () => {
    const details = delayedResponse();
    const {login, id} = await authorized(
      installationPage(7), repositoryPage(noteRepo), details.read,
      installationPage(7), repositoryPage(updated),
    );
    await login.repositories(id);
    const selection = login.select(id, noteRepo.id);
    await details.started;
    await login.repositories(id);
    details.finish(updated);
    assert.deepEqual((await selection).config, {
      mode:"github-api", remote:"https://github.com/" + updated.full_name + ".git", branch:updated.default_branch,
    });
  });
}

test("a renamed repository can be selected after refresh if its previous name has been reused", async () => {
  const renamed = row(noteRepo.id, "writer/new-notes", "docs/main");
  const reused = row(91, noteRepo.full_name, "main");
  const {login, id, requests} = await authorized(
    installationPage(7), repositoryPage(noteRepo), reused,
    installationPage(7), repositoryPage(renamed), renamed,
  );
  await login.repositories(id);
  await assert.rejects(login.select(id, noteRepo.id), /권한.*새로고침/);
  assert.equal(new URL(requests.at(-1).url).pathname, "/repos/writer/notes");
  const [choice] = await login.repositories(id);
  const {config} = await login.select(id, choice.id);
  assert.equal(new URL(requests.at(-1).url).pathname, "/repos/writer/new-notes");
  assert.deepEqual(config, {mode:"github-api", remote:"https://github.com/writer/new-notes.git", branch:"docs/main"});
});

for (const [reason, details, expected] of [
  ["the user loses write permission", {...noteRepo, permissions:{push:false}}, /쓰기 권한/],
  ["the repository is archived", {...noteRepo, archived:true}, /쓰기 권한/],
  ["the repository is disabled", {...noteRepo, disabled:true}, /쓰기 권한/],
  ["the token is revoked", Response.json({message:"Bad credentials"}, {status:401}), /로그인을 다시/],
]) {
  test("a previously listed repository cannot be connected after " + reason, async () => {
    const {login, id} = await authorized(installationPage(7), repositoryPage(noteRepo), details);
    const [choice] = await login.repositories(id);
    await assert.rejects(login.select(id, choice.id), expected);
  });
}

test("granting installation contents write access makes its repositories available on refresh", async () => {
  const readOnly = {id:7, permissions:{contents:"read"}};
  const {login, id, requests} = await authorized(
    {total_count:1, installations:[readOnly]},
    installationPage(7), repositoryPage(noteRepo), noteRepo,
  );
  assert.deepEqual(await login.repositories(id), []);
  await assert.rejects(login.select(id, noteRepo.id), /목록에서/);
  assert.equal(requests.length, 3);
  const [choice] = await login.repositories(id);
  assert.equal((await login.select(id, choice.id)).config.remote, "https://github.com/writer/notes.git");
});

test("after a 503 partway through discovery only complete repository lists are offered on retry", async () => {
  const first = row(58, "writer/first", "main"), second = row(59, "writer/second", "main");
  const unavailable = Response.json({message:"Service Unavailable"}, {status:503});
  const {login, id, requests} = await authorized(
    installationPage(7), repositoryPage(noteRepo),
    installationPage(7, 8), repositoryPage(first), unavailable,
    noteRepo,
    installationPage(7, 8), repositoryPage(first), repositoryPage(second), second,
  );
  await login.repositories(id);
  await assert.rejects(login.repositories(id), /HTTP 503/);
  await assert.rejects(login.select(id, first.id), /목록에서/);
  assert.equal((await login.select(id, noteRepo.id)).config.branch, noteRepo.default_branch);
  const retryStart = requests.length;
  assert.deepEqual((await login.repositories(id)).map(repo => repo.id), [first.id, second.id]);
  assert.deepEqual(requests.slice(retryStart).map(call => new URL(call.url).pathname), [
    "/user/installations", "/user/installations/7/repositories", "/user/installations/8/repositories",
  ]);
  await assert.rejects(login.select(id, noteRepo.id), /목록에서/);
  assert.equal((await login.select(id, second.id)).config.remote, "https://github.com/writer/second.git");
});

test("cancelling a pending list stops discovery before the next installation", async () => {
  const page = delayedResponse();
  const {login, id, requests} = await authorized(installationPage(7, 8), page.read);
  const listing = login.repositories(id);
  await page.started;
  const sent = requests.length;
  login.cancel(id);
  page.finish(repositoryPage(noteRepo));
  await assert.rejects(listing, /로그인을 다시/);
  assert.equal(requests.length, sent);
});

test("switching accounts during repository selection discards the old choice and its credentials", async () => {
  const details = delayedResponse();
  const other = row(95, "other-account/notes", "main");
  const nextGrant = {...grant, access_token:"other-account-access", refresh_token:"other-account-refresh"};
  const {login, id, advance, requests} = await authorized(
    installationPage(7), repositoryPage(noteRepo), details.read,
    challenge, nextGrant, installationPage(21), repositoryPage(other), other,
  );
  await login.repositories(id);
  const oldSelection = login.select(id, noteRepo.id);
  await details.started;
  const next = await login.start();
  advance(next.waitMs);
  await login.poll(next.id);
  const [choice] = await login.repositories(next.id);
  details.finish(noteRepo);
  await assert.rejects(oldSelection, /로그인을 다시/);
  await assert.rejects(login.select(next.id, noteRepo.id), /목록에서/);
  const selection = await login.select(next.id, choice.id);
  assert.equal(selection.config.remote, "https://github.com/other-account/notes.git");
  assert.equal(selection.credentials.accessToken, nextGrant.access_token);
  assert.equal(requests.at(-1).headers.Authorization, "Bearer " + nextGrant.access_token);
});
