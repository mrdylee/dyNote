import assert from "node:assert/strict";
import test from "node:test";
import { searchWorkspace, replaceMatches } from "../core/workspace-find.mjs";

const file = { key: "a", path: "팀/주간/노트.md", content: "기록\r\n단어 단어장 단어.\r\nA.1 a.2\n" };
const find = (options) =>
  searchWorkspace([file], { query: "단어", include: "", exclude: "", ...options })[0]?.matches ?? [];

test("whole-word matching handles Korean, nested globs and original CRLF offsets", () => {
  const matches = find({ wholeWord: true, include: "**/노트.m?, *.txt", exclude: "보관/**" });
  assert.deepEqual(
    matches.map((m) => [m.line, m.column]),
    [
      [1, 0],
      [1, 7],
    ],
  );
  assert.equal(replaceMatches(file.content, matches, "$1", false), "기록\r\n$1 단어장 $1.\r\nA.1 a.2\n");
  assert.deepEqual(find({ exclude: "팀/" }), []);
});
test("captures, literal metacharacters, empty replacements and zero-width matches", () => {
  const matches = find({ query: "a\\.(?<id>\\d)", regexp: true });
  assert.equal(
    replaceMatches(file.content, matches, "$<id>/$1/$$/$&", true).split("\r\n").at(-1),
    "1/1/$/A.1 2/2/$/a.2\n",
  );
  assert.equal(find({ query: "A.", caseSensitive: true }).length, 1);
  assert.equal(replaceMatches("A.1", [{ from: 0, text: "A.1" }], "", false), "");
  assert.equal(find({ query: "(?=단어)", regexp: true }).length, 3);
  assert.throws(() => find({ query: "[", regexp: true }));
});
