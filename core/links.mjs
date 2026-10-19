import MarkdownIt from "markdown-it";
const parser = new MarkdownIt({ html: false });
const fold = (s) => s.normalize("NFC").toLowerCase();
export function normalizePath(value) {
  const out = [];
  for (const bit of value.replaceAll("\\", "/").split("/")) {
    if (bit === "..") {
      if (!out.length) return null;
      out.pop();
    } else if (bit && bit !== ".") out.push(bit);
  }
  return out.join("/");
}
export function createLinkIndex(files) {
  const paths = new Map(), names = new Map(), aliases = new Map();
  const add = (map, key, file) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(file);
  };
  for (const file of files) {
    add(paths, fold(file.path), file);
    add(names, fold(file.path.split("/").at(-1)), file);
    for (const alias of file.aliases ?? [])
      add(aliases, fold(alias.replace(/\.md$/i, "")), file);
  }
  return { paths, names, aliases };
}
export function resolvePath(target, from, files, { kind = "wiki", index } = {}) {
  let clean;
  try {
    clean = decodeURIComponent(target.split(/[#^]/)[0]).trim();
  } catch {
    return { status: "missing", path: null };
  }
  if (!clean) return { status: "resolved", path: from };
  if (clean.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(clean))
    return { status: "missing", path: null };
  if (!/\.[a-z0-9]+$/i.test(clean)) clean += ".md";
  const folder = from.includes("/")
    ? from.slice(0, from.lastIndexOf("/") + 1)
    : "";
  const candidates =
    kind === "markdown" || clean.startsWith(".")
      ? [folder + clean, clean]
      : [clean, folder + clean];
  for (const candidate of candidates.map(normalizePath)) {
    if (!candidate) continue;
    const found = index
      ? [...(index.paths.get(fold(candidate)) ?? [])]
      : files.filter((n) => fold(n.path) === fold(candidate));
    if (found.length)
      return {
        status: found.length === 1 ? "resolved" : "ambiguous",
        path: found.length === 1 ? found[0].path : null,
      };
  }
  if (clean.includes("/")) return { status: "missing", path: null };
  const matches = index
    ? [...new Set([...(index.names.get(fold(clean)) ?? []), ...(index.aliases.get(fold(clean.replace(/\.md$/i, ""))) ?? [])])]
    : files.filter(
    (n) =>
      fold(n.path.split("/").at(-1)) === fold(clean) ||
      (n.aliases ?? []).some(
        (a) =>
          fold(a.replace(/\.md$/i, "")) === fold(clean.replace(/\.md$/i, "")),
      ),
  );
  return {
    status:
      matches.length === 1
        ? "resolved"
        : matches.length
          ? "ambiguous"
          : "missing",
    path: matches.length === 1 ? matches[0].path : null,
  };
}
export function scanLinks(source) {
  const chars = source.split("");
  const offsets = [0];
  for (let i = 0; i < source.length; i++)
    if (source[i] === "\n") offsets.push(i + 1);
  for (const token of parser.parse(source, {})) {
    if (["fence", "code_block"].includes(token.type) && token.map) {
      const start = offsets[token.map[0]];
      const end = offsets[token.map[1]] ?? source.length;
      for (let i = start; i < end; i++) if (chars[i] !== "\n") chars[i] = " ";
    }
  }
  let masked = chars.join("");
  masked = masked.replace(/(`+)([^`]|(?!\1)`)*?\1/g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  const links = [];
  let m;
  const wiki = /!?\[\[([^\]\n]+)\]\]/g;
  while ((m = wiki.exec(masked))) {
    if (source[m.index - 1] === "\\") continue;
    const raw = source.slice(m.index, m.index + m[0].length);
    const inner = raw.slice(raw.startsWith("!") ? 3 : 2, -2);
    const [target, ...alias] = inner.split(/(?<!\\)\|/);
    links.push({
      start: m.index,
      end: m.index + m[0].length,
      raw,
      target: target.trim(),
      label: alias.join("|").replaceAll("\\|", "|").trim() || target.trim(),
      kind: "wiki",
      embed: raw.startsWith("!"),
    });
  }
  const destinationAt = (start, offset, label, embed, reference = false) => {
    const dest = parser.helpers.parseLinkDestination(
      masked,
      offset,
      masked.length,
    );
    if (!dest.ok || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(dest.str)) return;
    const ending = reference
      ? null
      : /^\s*(?:"[^"\n]*"|'[^'\n]*')?\s*\)/.exec(masked.slice(dest.pos));
    if (!reference && !ending) return;
    const angle = masked[offset] === "<";
    const targetStart = offset + (angle ? 1 : 0) - start;
    const targetEnd = dest.pos - (angle ? 1 : 0) - start;
    const end = reference ? dest.pos : dest.pos + ending[0].length;
    links.push({
      start,
      end,
      raw: source.slice(start, end),
      target: dest.str,
      targetStart,
      targetEnd,
      label,
      kind: "markdown",
      embed,
    });
  };
  const markdown = /(!?)\[([^\]\n]*)\]\(/g;
  while ((m = markdown.exec(masked))) {
    if (
      links.some((l) => m.index >= l.start && m.index < l.end) ||
      source[m.index - 1] === "\\"
    )
      continue;
    destinationAt(m.index, m.index + m[0].length, m[2], !!m[1]);
  }
  const decoded = (value) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const used = new Set(
    parser
      .parse(masked, {})
      .flatMap((t) => t.children ?? [])
      .filter((t) => t.type === "link_open" || t.type === "image")
      .map((t) =>
        decoded(t.attrGet(t.type === "image" ? "src" : "href") ?? ""),
      ),
  );
  const references = /^ {0,3}\[([^\]^]+)\]:[ \t]*/gm;
  while ((m = references.exec(masked))) {
    const dest = parser.helpers.parseLinkDestination(
      masked,
      m.index + m[0].length,
      masked.length,
    );
    if (dest.ok && used.has(decoded(dest.str)))
      destinationAt(m.index, m.index + m[0].length, m[1], false, true);
  }
  return links.sort((a, b) => a.start - b.start);
}
function relativePath(from, to) {
  const a = from.split("/").slice(0, -1),
    b = to.split("/");
  while (a.length && b.length && a[0] === b[0]) {
    a.shift();
    b.shift();
  }
  return [...a.map(() => ".."), ...b].join("/");
}
export function rewriteLinks(source, from, oldPath, newPath, files) {
  const newFrom = from === oldPath ? newPath : from;
  let result = source;
  for (const link of scanLinks(source).reverse()) {
    const resolved = resolvePath(link.target, from, files, { kind: link.kind });
    if (resolved.status !== "resolved") continue;
    const destination = resolved.path === oldPath ? newPath : resolved.path;
    if (destination === resolved.path && newFrom === from) continue;
    const fragment = link.target.match(/[#^].*$/)?.[0] ?? "";
    const target =
      link.kind === "wiki"
        ? destination.replace(/\.md$/i, "") + fragment
        : relativePath(newFrom, destination)
            .split("/")
            .map(encodeURIComponent)
            .join("/") + fragment;
    const start = link.targetStart ?? link.raw.indexOf(link.target);
    const end = link.targetEnd ?? start + link.target.length;
    const raw = link.raw.slice(0, start) + target + link.raw.slice(end);
    result = result.slice(0, link.start) + raw + result.slice(link.end);
  }
  return result;
}
