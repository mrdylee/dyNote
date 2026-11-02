import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { z } = createRequire(import.meta.resolve("@github/copilot-sdk"))("zod");

const values = Array.from({ length: 1024 }, (_, index) => index);
for (const [name, schema, oversized, valid] of [
  ["array", z.array(z.string()).max(2), values, ["one", "two"]],
  ["set", z.set(z.string()).max(2), new Set(values), new Set(["one", "two"])],
  ["map", z.map(z.string(), z.string()).max(2), new Map(values.map(value => [value, value])), new Map([["one", "two"]])],
]) {
  test(`Copilot dependency rejects oversized ${name} before accumulating element errors`, () => {
    const result = schema.safeParse(oversized);
    assert.equal(result.success, false);
    assert.equal(result.error.issues.length, 1);
    assert.deepEqual(result.error.issues.map(issue => ({ code: issue.code, path: issue.path })), [{ code: "too_big", path: [] }]);
    assert.deepEqual(schema.parse(valid), valid);
  });
}
