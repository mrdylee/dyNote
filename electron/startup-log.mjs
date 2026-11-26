import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";

const MAX_LOG_BYTES = 128 * 1024;

export function createStartupLog(directory, version) {
  const filename = path.join(directory, "startup.log");
  const started = performance.now();
  const run = `${new Date().toISOString()}:${process.pid}`;
  const recorded = new Set();
  let writable = true;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (statSync(filename, { throwIfNoEntry: false })?.size >= MAX_LOG_BYTES)
      renameSync(filename, path.join(directory, "startup.previous.log"));
  } catch { writable = false; }

  function write(stage, event, stageStarted) {
    if (!writable) return;
    const now = performance.now();
    const entry = {
      time: new Date().toISOString(), run, version, stage, event,
      elapsedMs: Math.round(now - started),
      durationMs: stageStarted === undefined ? undefined : Math.round(now - stageStarted),
    };
    try { appendFileSync(filename, JSON.stringify(entry) + "\n", { mode: 0o600 }); }
    catch { writable = false; }
  }

  return {
    mark(stage, event = "mark") {
      if (recorded.has(stage)) return;
      recorded.add(stage);
      write(stage, event);
    },
    async run(stage, operation) {
      if (recorded.has(stage)) return operation();
      recorded.add(stage);
      const stageStarted = performance.now();
      write(stage, "begin");
      try {
        const result = await operation();
        write(stage, "ok", stageStarted);
        return result;
      } catch (error) {
        write(stage, "error", stageStarted);
        throw error;
      }
    },
  };
}
