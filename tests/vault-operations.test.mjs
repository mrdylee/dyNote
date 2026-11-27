import test from "node:test";
import assert from "node:assert/strict";
import { VaultOperations } from "../electron/vault-operations.mjs";

test("a vault checkout excludes only overlapping writes and releases its locks", () => {
  const ops = new VaultOperations();
  const fetch = ops.begin(["personal"]);
  const checkout = ops.begin(["team"], true);
  const write = ops.begin(["personal"]);
  assert.throws(() => ops.begin(["team"]));
  assert.throws(() => ops.begin(["personal", "team"], true));
  assert.throws(() => ops.begin([], true));
  checkout(); fetch(); write();
  assert.equal(ops.active, false);
  const global = ops.begin([], true);
  assert.throws(() => ops.begin(["personal"]));
  global();
  const transfer = ops.begin(["personal", "team"], true);
  assert.throws(() => ops.begin(["personal"]));
  assert.throws(() => ops.begin(["team"]));
  transfer();
});

test("capture waits for dismissed version reads in its own vault and still respects active writes", async () => {
  const ops = new VaultOperations();
  const first = ops.begin(["a"],false,false,"a"), second = ops.begin(["a"],false,false,"a");
  const other = ops.begin(["b"],false,false,"b"), write = ops.begin(["a"]);
  let ready = false;
  const waiting = ops.waitForReviewReads("a").then(() => { ready = true; });
  first();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ready,false);
  second();
  await waiting;
  assert.throws(() => ops.begin(["a"],true), /저장 작업/);
  write();
  ops.begin(["a"],true)();
  other();
});
