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
