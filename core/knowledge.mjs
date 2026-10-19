import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import { katex } from "@mdit/plugin-katex";
import { createLinkIndex, resolvePath, scanLinks } from "./links.mjs";
import { SearchIndex } from "./searchIndex.mjs";
import { parseMetadata } from "./metadata.mjs";
import { installMarkdownExtensions } from "./markdown-extensions.mjs";
export { parseMetadata, updateMetadata, toggleTask } from "./metadata.mjs";

const md = new MarkdownIt({ html: false, breaks: true, linkify: false })
  .use(footnote)
  .use(katex, { trust: false, throwOnError: false, output: "html" });

// The table block parser runs before inline rules; protect wikilink alias pipes first.
md.core.ruler.before("block", "wiki_table_pipes", (state) => {
  let fence = null;
  state.src = state.src
    .split("\n")
    .map((line) => {
      const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker) {
        if (!fence) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length)
          fence = null;
        return line;
      }
      if (fence || !/^\s*\|/.test(line)) return line;
      return line.replace(/\[\[[^\]\n]+\]\]/g, (link) =>
        link.replace(/(?<!\\)\|/g, "\\|"),
      );
    })
    .join("\n");
});

md.inline.ruler.before("link", "wikilink", (state, silent) => {
  const match = /^\[\[([^\]\n]+)\]\]/.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) {
    const [target, ...alias] = match[1].split("|");
    const token = state.push("wikilink", "", 0);
    token.meta = {
      target: target.trim(),
      label: alias.join("|").trim() || target.trim(),
    };
  }
  state.pos += match[0].length;
  return true;
});

export const resolveLink = resolvePath;
export function extractLinks(source) {
  return scanLinks(parseMetadata(source).body).map(
    ({ target, label, kind, embed }) => ({ target, label, kind, embed }),
  );
}
export function suggestNotes(notes, query) {
  const q = query.normalize("NFC").toLowerCase();
  return notes
    .filter((n) =>
      [n.title, n.path, ...(n.aliases ?? [])].some((v) =>
        String(v).normalize("NFC").toLowerCase().includes(q),
      ),
    )
    .slice(0, 20)
    .map((n) => ({
      label: n.title ?? n.path,
      detail: n.path,
      insert: n.path.replace(/\.md$/i, ""),
    }));
}
export function attachmentUrl(
  target,
  from,
  attachments,
  vaultId,
  kind = "markdown",
) {
  if (!vaultId) return null;
  const r = resolvePath(target, from, attachments, { kind });
  return r.status === "resolved"
    ? `notes://vault/${encodeURIComponent(vaultId)}/${r.path.split("/").map(encodeURIComponent).join("/")}`
    : null;
}

const parsedNotes = new Map();
export function buildKnowledge(raw) {
  const present = new Set(raw.map((n) => n.path));
  for (const path of parsedNotes.keys())
    if (!present.has(path)) parsedNotes.delete(path);
  const notes = raw.map((note) => {
    const cached = parsedNotes.get(note.path);
    if (cached?.content === note.content) return { ...note, ...cached.parsed };
    const meta = parseMetadata(note.content);
    const tokens = md.parse(meta.body, {});
    const headings = [];
    tokens.forEach((token, i) => {
      if (token.type === "heading_open")
        headings.push({
          level: Number(token.tag.slice(1)),
          text: tokens[i + 1]?.content ?? "",
          line: (token.map?.[0] ?? 0) + meta.offset,
        });
    });
    const prose = tokens
      .flatMap((t) => t.children ?? [])
      .filter((t) => t.type === "text")
      .map((t) => t.content)
      .join(" ");
    const propertyTags =
      typeof meta.properties.tags === "string"
        ? meta.properties.tags.split(/[, ]+/)
        : Array.isArray(meta.properties.tags)
          ? meta.properties.tags.filter((t) => typeof t === "string")
          : [];
    const tags = [
      ...new Set([
        ...propertyTags,
        ...[...prose.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map(
          (m) => m[1],
        ),
      ]),
    ];
    const parsed = {
      ...meta,
      properties: meta.properties,
      aliases:
        typeof meta.properties.aliases === "string"
          ? [meta.properties.aliases]
          : Array.isArray(meta.properties.aliases)
            ? meta.properties.aliases.filter((a) => typeof a === "string")
            : [],
      title:
        headings.find((h) => h.level === 1)?.text ||
        note.path.split("/").at(-1).replace(/\.md$/i, ""),
      headings,
      tags,
      links: scanLinks(meta.body).map(
        ({ target, label, kind, embed }) => ({ target, label, kind, embed }),
      ),
    };
    parsedNotes.set(note.path, { content: note.content, parsed });
    return { ...note, ...parsed };
  });
  const index = createLinkIndex(notes);
  const backlinks = Object.fromEntries(notes.map((n) => [n.path, []]));
  const edges = [];
  const seen = new Set();
  for (const note of notes)
    for (const link of note.links) {
      const target = resolveLink(link.target, note.path, notes, {
        kind: link.kind,
        index,
      });
      const key = note.path + "\0" + target.path;
      if (
        target.status !== "resolved" ||
        target.path === note.path ||
        seen.has(key)
      )
        continue;
      seen.add(key);
      edges.push({ source: note.path, target: target.path });
      backlinks[target.path]?.push(note);
    }
  return { notes, edges, backlinks };
}

const searchIndex = new SearchIndex();
const indexed = new Map();
export function searchNotes(notes, query) {
  if (!query.trim()) return notes;
  const present = new Set(notes.map((n) => n.path));
  for (const key of indexed.keys())
    if (!present.has(key)) {
      searchIndex.remove(key);
      indexed.delete(key);
    }
  for (const n of notes) {
    const signature = [n.content, n.title, (n.tags ?? []).join("\0")];
    const previous = indexed.get(n.path);
    if (!previous || signature.some((v, i) => v !== previous[i])) {
      searchIndex.add({
        id: n.path,
        path: n.path,
        title: n.title ?? n.path,
        text: n.content,
        tags: n.tags ?? [],
        mtime: 0,
      });
      indexed.set(n.path, signature);
    }
  }
  const byPath = new Map(notes.map((n) => [n.path, n]));
  return searchIndex.search(query, { limit: 1000 }).map((hit) => ({
    ...byPath.get(hit.path),
    score: hit.score,
    snippet: hit.snippet,
  }));
}
export function renderMarkdown(source, notes = [], from = "", options = {}) {
  const meta = parseMetadata(source);
  return md.render(meta.body, {
    ...options,
    from,
    notes,
    bodyOffset: meta.offset,
    visited: options.visited ?? [from],
  });
}
installMarkdownExtensions(md, { resolveLink, renderMarkdown, attachmentUrl });
