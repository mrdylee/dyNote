import { parseCanvas } from "./canvas.mjs";
import { parseBase } from "./bases.mjs";
export const documentKind = (path) =>
  /\.canvas$/i.test(path) ? "canvas" : /\.base$/i.test(path) ? "base" : null;
export function validateDocument(path, source) {
  if (documentKind(path) === "canvas") return parseCanvas(source);
  if (documentKind(path) === "base") return parseBase(source);
  throw new Error("Canvas 또는 Bases 파일이어야 합니다.");
}
export const initialDocument = (path) =>
  documentKind(path) === "canvas"
    ? '{\n  "nodes": [],\n  "edges": []\n}\n'
    : "views:\n  - type: table\n    name: 문서 목록\n";
