// Uses only a disposable synthetic value, never a real account credential.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CopilotClient } from "@github/copilot-sdk";
import { CopilotController, runtimeEnvironment } from "../electron/copilot-controller.mjs";
import { sessionOptions } from "../core/copilot.mjs";

const profile = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-keychain-probe-")));
const report = { platform: process.platform, baseline: null, fixed: null };
try {
  for (const mode of ["empty", "desktop"]) {
    const directory = path.join(profile, mode);
    await mkdir(path.join(directory, "workspace"), { recursive: true });
    const controller = new CopilotController({ directory, onEvent() {}, openExternal() {} });
    const client = mode === "desktop" ? await controller.createClient() : new CopilotClient({
      mode: "empty", baseDirectory: directory, workingDirectory: path.join(directory, "workspace"),
      env: runtimeEnvironment(), logLevel: "error", enableRemoteSessions: false,
    });
    let store, session;
    try {
      await client.start();
      const candidateStore = client.internalRpc.sandbox.proxySecret;
      const location = await candidateStore.getLocation();
      // This diagnostic endpoint uses an entry derived from COPILOT_HOME.
      // Refuse to read or modify any store outside this disposable profile.
      const root = await realpath(directory);
      assert.ok(location.configDir.startsWith(root + path.sep));
      assert.equal((await candidateStore.get()).value, undefined);
      store = candidateStore;
      const value = `Dynote synthetic credential-store check: ${mode}`;
      const saved = await store.save({ value });
      assert.equal((await store.get()).value, value);
      const result = { storedInKeychain: saved.storedInKeychain, roundTrip: true };
      if (mode === "empty") {
        report.baseline = result;
        assert.equal(saved.storedInKeychain, false);
      } else {
        report.fixed = result;
        assert.equal(saved.storedInKeychain, true);
        session = await client.createSession(sessionOptions(null, "chat"));
        await session.rpc.options.update({ installedPlugins: [] });
        report.restrictedSessionCreated = true;
      }
    } finally {
      try {
        if (session) await client.deleteSession(session.sessionId);
        if (store) {
          await store.delete();
          assert.equal((await store.get()).value, undefined);
        }
      } finally { await client.stop(); }
    }
  }
  report.syntheticValuesRemoved = true;
  await writeFile("docs/verification/copilot-keychain.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(profile, { recursive: true, force: true });
}
