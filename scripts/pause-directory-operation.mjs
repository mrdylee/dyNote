// Delay one filesystem call in the test Electron process without changing the IPC or renderer.
export async function pauseDirectoryOperation(app, method, folder) {
  await app.evaluate((_electron, {method, folder}) => {
    const fs = process.getBuiltinModule("node:fs/promises");
    const sync = process.getBuiltinModule("node:module").syncBuiltinESMExports;
    const original = fs[method], started = Promise.withResolvers(), release = Promise.withResolvers();
    fs[method] = async (name, ...args) => {
      if (name === folder) {
        fs[method] = original; sync();
        started.resolve();
        await release.promise;
      }
      return original(name, ...args);
    };
    sync();
    globalThis.directoryOperation = { started:started.promise, resume() {
      fs[method] = original; sync(); release.resolve();
      delete globalThis.directoryOperation;
    }};
  }, {method, folder});
  return {
    wait: () => app.evaluate(() => Promise.race([globalThis.directoryOperation.started,
      new Promise((_, reject) => setTimeout(() => reject(Error("Directory operation did not start")), 10000))])),
    resume: () => app.evaluate(() => globalThis.directoryOperation.resume()),
  };
}
