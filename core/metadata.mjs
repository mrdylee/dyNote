import { parseDocument } from "yaml";

export function parseMetadata(source) {
  const match = /^(\uFEFF?---\r?\n)([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match)
    return { body: source, properties: {}, yaml: "", offset: 0, error: null };
  const result = {
    body: source.slice(match[0].length),
    yaml: match[2],
    offset: match[0].split("\n").length - 1,
  };
  try {
    const doc = parseDocument(match[2], { uniqueKeys: true });
    if (doc.errors.length) throw doc.errors[0];
    const properties = doc.toJS({ maxAliasCount: 0 });
    if (
      properties !== null &&
      (typeof properties !== "object" || Array.isArray(properties))
    )
      throw new Error("속성은 이름: 값 형식이어야 합니다.");
    return { ...result, properties: properties ?? {}, error: null };
  } catch (error) {
    return { ...result, properties: {}, error: error.message };
  }
}

export function updateMetadata(source, yaml) {
  const parsed = parseMetadata(`---\n${yaml}\n---\n`);
  if (parsed.error) throw new Error(parsed.error);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  return `${source.startsWith("\uFEFF") ? "\uFEFF" : ""}---${newline}${yaml.trim().replace(/\r?\n/g, newline)}${newline}---${newline}${parseMetadata(source).body.replace(/^\uFEFF/, "")}`;
}

export function toggleTask(source, line, checked) {
  const lines = source.split("\n");
  if (
    !Number.isInteger(line) ||
    !/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/.test(lines[line] ?? "")
  )
    throw new Error("체크박스 위치가 변경되었습니다.");
  lines[line] = lines[line].replace(
    /^(\s*(?:[-*+]|\d+[.)])\s+)\[[ xX]\]/,
    `$1[${checked ? "x" : " "}]`,
  );
  return lines.join("\n");
}
