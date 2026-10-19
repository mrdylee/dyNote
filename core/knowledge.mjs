import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, breaks: true, linkify: false });
const escape = md.utils.escapeHtml;

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

md.renderer.rules.wikilink = (tokens, index, _options, env) => {
  const { target, label } = tokens[index].meta;
  const resolved = resolveLink(target, env.from ?? "", env.notes ?? []);
  return `<a href="#" class="wiki-link${resolved.status === "resolved" ? "" : " unresolved"}" data-note="${escape(target)}" title="${escape(target)}">${escape(label)}</a>`;
};
md.renderer.rules.image = (tokens, index) =>
  `<span class="image-placeholder">이미지 · ${escape(tokens[index].content || "첨부파일")} <small>불러오기 차단됨</small></span>`;
const defaultLink =
  md.renderer.rules.link_open ??
  ((tokens, index, options, _env, renderer) =>
    renderer.renderToken(tokens, index, options));
md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  const href = token.attrGet("href") ?? "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("//"))
    token.attrSet("data-note", href);
  else token.attrSet("data-external", "true");
  token.attrSet("rel", "noopener noreferrer");
  return defaultLink(tokens, index, options, env, renderer);
};

function inlineTokens(source) {
  return md.parse(source, {}).flatMap((token) => token.children ?? []);
}

export function extractLinks(source) {
  return inlineTokens(source)
    .filter((token) => token.type === "wikilink")
    .map((token) => ({ ...token.meta }));
}

function normalize(value) {
  const parts = [];
  for (const part of value.replaceAll("\\", "/").split("/")) {
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

export function resolveLink(target, from, notes) {
  let clean;
  try {
    clean = decodeURIComponent(target).split(/[\#^]/)[0].trim();
  } catch {
    return { status: "missing", path: null };
  }
  if (!clean) return { status: "resolved", path: from };
  if (clean.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(clean))
    return { status: "missing", path: null };
  if (!/\.md$/i.test(clean)) clean += ".md";
  const folder = from.includes("/")
    ? from.slice(0, from.lastIndexOf("/") + 1)
    : "";
  for (const candidate of [normalize(folder + clean), normalize(clean)]) {
    if (!candidate) continue;
    const found = notes.filter(
      (n) =>
        n.path.normalize("NFC").toLowerCase() ===
        candidate.normalize("NFC").toLowerCase(),
    );
    if (found.length === 1) return { status: "resolved", path: found[0].path };
    if (found.length > 1) return { status: "ambiguous", path: null };
  }
  if (clean.includes("/")) return { status: "missing", path: null };
  const matches = notes.filter(
    (n) =>
      n.path.split("/").at(-1).normalize("NFC").toLowerCase() ===
      clean.normalize("NFC").toLowerCase(),
  );
  return {
    status:
      matches.length === 1
        ? "resolved"
        : matches.length > 1
          ? "ambiguous"
          : "missing",
    path: matches.length === 1 ? matches[0].path : null,
  };
}

export function buildKnowledge(raw) {
  const notes = raw.map((note) => {
    const tokens = md.parse(note.content, {});
    const headings = [];
    tokens.forEach((token, i) => {
      if (token.type === "heading_open")
        headings.push({
          level: Number(token.tag.slice(1)),
          text: tokens[i + 1]?.content ?? "",
        });
    });
    const prose = tokens
      .flatMap((t) => t.children ?? [])
      .filter((t) => t.type === "text")
      .map((t) => t.content)
      .join(" ");
    const tags = [
      ...new Set(
        [...prose.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map((m) => m[1]),
      ),
    ];
    return {
      ...note,
      title:
        headings.find((h) => h.level === 1)?.text ||
        note.path.split("/").at(-1).replace(/\.md$/i, ""),
      headings,
      tags,
      links: extractLinks(note.content),
    };
  });
  const backlinks = Object.fromEntries(notes.map((n) => [n.path, []]));
  const edges = [];
  const seen = new Set();
  for (const note of notes)
    for (const link of note.links) {
      const target = resolveLink(link.target, note.path, notes);
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

export function searchNotes(notes, query) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return notes;
  return notes
    .map((note) => {
      const title = (note.title ?? note.path).toLocaleLowerCase();
      const body = note.content.toLocaleLowerCase();
      const score = terms.every((t) =>
        `${title}\n${body}\n${note.path.toLocaleLowerCase()}`.includes(t),
      )
        ? terms.reduce((n, t) => n + (title.includes(t) ? 10 : 1), 0)
        : 0;
      const position = Math.max(0, body.indexOf(terms[0]) - 32);
      return {
        ...note,
        score,
        snippet: note.content
          .slice(position, position + 110)
          .replaceAll("\n", " "),
      };
    })
    .filter((n) => n.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path, "ko"));
}

export function renderMarkdown(source, notes = [], from = "") {
  return md.render(source, { notes, from });
}
