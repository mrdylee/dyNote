import { parseDocument } from "yaml";
import {
  compileFilter,
  compileFormulaSet,
  createEvaluationContext,
  evaluateToPlain,
} from "obsidian-bases-expression";
import { parseMetadata } from "./metadata.mjs";
import { resolvePath } from "./links.mjs";

const record = (v) => v && typeof v === "object" && !Array.isArray(v);
export function parseBase(source) {
  const doc = parseDocument(source, { uniqueKeys: true });
  if (doc.errors.length) throw new Error(doc.errors[0].message);
  const data = doc.toJS({ maxAliasCount: 0 });
  if (
    !record(data) ||
    !Array.isArray(data.views) ||
    !data.views.length ||
    data.views.some((v) => !record(v))
  )
    throw new Error("Bases에는 하나 이상의 views 설정이 필요합니다.");
  const warnings = [];
  if (
    Object.keys(data).some(
      (key) =>
        !["filters", "formulas", "properties", "views", "summaries"].includes(
          key,
        ),
    ) ||
    data.views.some((v) =>
      Object.keys(v).some(
        (key) =>
          ![
            "type",
            "name",
            "order",
            "filters",
            "groupBy",
            "groupOrder",
            "sort",
            "limit",
            "summaries",
          ].includes(key),
      ),
    )
  )
    warnings.push("지원하지 않는 설정 항목이 있습니다.");
  if (
    data.properties &&
    (!record(data.properties) ||
      Object.values(data.properties).some(
        (p) =>
          !record(p) ||
          (p.displayName !== undefined && typeof p.displayName !== "string"),
      ))
  )
    throw new Error("속성 표시 이름은 문자열이어야 합니다.");
  if (
    data.views.some((v) => v.name !== undefined && typeof v.name !== "string")
  )
    throw new Error("보기 이름은 문자열이어야 합니다.");
  if (data.views.some((v) => v.type !== "table"))
    warnings.push("표 이외의 보기 형식은 아직 지원하지 않습니다.");
  if (data.summaries || data.views.some((v) => v.summaries || v.groupOrder))
    warnings.push("요약 계산·그룹 표시 순서 설정은 아직 지원하지 않습니다.");
  if (
    data.formulas &&
    (!record(data.formulas) ||
      Object.values(data.formulas).some((v) => typeof v !== "string"))
  )
    throw new Error("계산식은 이름: 문자열 형식이어야 합니다.");
  for (const v of data.views) {
    if (
      v.order &&
      (!Array.isArray(v.order) || v.order.some((x) => typeof x !== "string"))
    )
      throw new Error("표의 order는 열 이름 목록이어야 합니다.");
    if (v.limit !== undefined && (!Number.isInteger(v.limit) || v.limit < 0))
      throw new Error("limit은 0 이상의 정수여야 합니다.");
    if (
      v.sort &&
      (!Array.isArray(v.sort) ||
        v.sort.some(
          (s) =>
            !record(s) ||
            typeof s.property !== "string" ||
            !["ASC", "DESC"].includes(s.direction),
        ))
    )
      throw new Error(
        "sort는 property와 ASC/DESC direction 목록이어야 합니다.",
      );
    if (
      v.groupBy &&
      (!record(v.groupBy) ||
        typeof v.groupBy.property !== "string" ||
        !["ASC", "DESC"].includes(v.groupBy.direction))
    )
      throw new Error(
        "groupBy에는 property와 ASC/DESC direction이 필요합니다.",
      );
  }
  return { data, readOnly: warnings.length > 0, warnings };
}

export function evaluateBase(source, notes, viewIndex = 0, basePath = "") {
  const parsed = parseBase(source),
    { data } = parsed;
  const view = data.views[viewIndex];
  if (!view) throw new Error("선택한 보기가 없습니다.");
  if (view.type !== "table")
    return { ...parsed, rows: [], columns: [], groups: [] };
  const filter = compileFilter({ and: [data.filters, view.filters] });
  if (!filter.valid)
    throw new Error(filter.diagnostics.map((d) => d.message).join(" · "));
  const formulaSet = compileFormulaSet(data.formulas ?? {});
  if (formulaSet.diagnostics.some((d) => d.severity === "error"))
    throw new Error(formulaSet.diagnostics.map((d) => d.message).join(" · "));
  const columns = view.order?.length
    ? view.order
    : [
        "file.name",
        ...new Set(
          notes
            .flatMap((n) => Object.keys(n.properties ?? {}))
            .map((k) => `note.${k}`),
        ),
      ].slice(0, 30);
  const fields = [
    ...new Set([
      ...columns,
      ...(view.sort ?? []).map((s) => s.property),
      ...(view.groupBy ? [view.groupBy.property] : []),
    ]),
  ];
  const rows = [];
  const linksByPath = new Map(
    notes.map((n) => [
      n.path,
      (n.links ?? [])
        .map((l) => resolvePath(l.target, n.path, notes, { kind: l.kind }))
        .filter((r) => r.status === "resolved")
        .map((r) => r.path),
    ]),
  );
  for (const n of notes) {
    if (n.error) continue;
    const links = linksByPath.get(n.path);
    const backlinks = notes
      .filter((other) => linksByPath.get(other.path).includes(n.path))
      .map((other) => other.path);
    const context = createEvaluationContext({
      note: n.properties ?? {},
      file: {
        path: n.path,
        ...n.metadata,
        tags: n.tags ?? [],
        links,
        backlinks,
      },
      formulas: data.formulas ?? {},
      thisFile: { path: basePath },
    });
    const matches = filter.evaluate(context);
    if (matches.value.type === "Error")
      throw new Error(matches.value.value.message);
    if (!matches.matches) continue;
    const values = Object.create(null);
    for (const key of fields) {
      // Property IDs are names, not arbitrary expressions. Brackets support spaces and Korean names.
      const expression =
        key.startsWith("file.") || key.startsWith("formula.")
          ? key
          : `note[${JSON.stringify(key.replace(/^note\./, ""))}]`;
      values[key] = evaluateToPlain(expression, context, {
        throwOnError: true,
      });
    }
    rows.push({ path: n.path, values });
  }
  const compare = (a, b) =>
    a == null
      ? b == null
        ? 0
        : -1
      : b == null
        ? 1
        : typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a).localeCompare(String(b), "ko", { numeric: true });
  rows.sort((a, b) => {
    for (const s of view.sort ?? []) {
      const order = compare(a.values[s.property], b.values[s.property]);
      if (order) return order * (s.direction === "DESC" ? -1 : 1);
    }
    return a.path.localeCompare(b.path, "ko");
  });
  const limited = view.limit === undefined ? rows : rows.slice(0, view.limit);
  const groups = new Map();
  for (const row of limited) {
    const value = view.groupBy ? row.values[view.groupBy.property] : null;
    const key =
      value == null
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const grouped = [...groups].map(([key, rows]) => ({ key, rows }));
  if (view.groupBy)
    grouped.sort(
      (a, b) =>
        compare(a.key, b.key) * (view.groupBy.direction === "DESC" ? -1 : 1),
    );
  return {
    ...parsed,
    rows: limited,
    columns,
    groups: grouped,
    grouped: !!view.groupBy,
  };
}

export function patchProperty(source, key, input) {
  if (!key || /[\0\r\n]/.test(key)) throw new Error("잘못된 속성 이름입니다.");
  const meta = parseMetadata(source);
  if (meta.error) throw new Error(meta.error);
  const doc = parseDocument(meta.yaml || "{}", { uniqueKeys: true });
  const old = meta.properties[key];
  let value = input;
  if (typeof old === "number") {
    value = Number(input);
    if (!input.trim() || !Number.isFinite(value))
      throw new Error("숫자를 입력해 주세요.");
  } else if (typeof old === "boolean") {
    if (!["true", "false"].includes(input))
      throw new Error("true 또는 false를 입력해 주세요.");
    value = input === "true";
  } else if (old !== null && typeof old === "object") {
    const parsed = parseDocument(input, { uniqueKeys: true });
    if (parsed.errors.length)
      throw new Error("올바른 YAML 값을 입력해 주세요.");
    value = parsed.toJS({ maxAliasCount: 0 });
    if (
      Array.isArray(old) !== Array.isArray(value) ||
      value === null ||
      typeof value !== "object"
    )
      throw new Error("기존 속성과 같은 형식으로 입력해 주세요.");
  }
  doc.set(key, value);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const yaml = doc.toString().trimEnd().replace(/\r?\n/g, newline);
  return `${source.startsWith("\uFEFF") ? "\uFEFF" : ""}---${newline}${yaml}${newline}---${newline}${meta.body.replace(/^\uFEFF/, "")}`;
}
