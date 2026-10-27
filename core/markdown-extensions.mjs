import { headingId } from "./headings.mjs";

export function installMarkdownExtensions(
  md,
  { resolveLink, renderMarkdown, attachmentUrl },
) {
  const escape = md.utils.escapeHtml;
  const fragment = (target) => target.split("#").slice(1).join("#");
  md.renderer.rules.heading_open = (tokens, index, options, _env, renderer) => {
    tokens[index].attrSet("id", headingId(tokens[index + 1]?.content ?? ""));
    return renderer.renderToken(tokens, index, options);
  };
  const image = (target, label, env, kind = "markdown") => {
    const url = attachmentUrl(
      target,
      env.from,
      env.attachments ?? [],
      env.vaultId,
      kind,
    );
    return url && /\.(?:png|jpe?g|gif|webp)(?:[#?]|$)/i.test(target)
      ? `<img src="${escape(url)}" alt="${escape(label)}" loading="lazy" />`
      : `<span class="image-placeholder">이미지 · ${escape(label)} <small>로컬 첨부파일만 표시합니다</small></span>`;
  };
  md.inline.ruler.at("wikilink", (state, silent) => {
    const match = /^(!?)\[\[([^\]\n]+)\]\]/.exec(state.src.slice(state.pos));
    if (!match) return false;
    if (!silent) {
      const [target, ...alias] = match[2].split("|");
      const token = state.push("wikilink", "", 0);
      token.meta = {
        target: target.trim(),
        label: alias.join("|").trim() || target.trim(),
        embed: !!match[1],
      };
    }
    state.pos += match[0].length;
    return true;
  });
  md.renderer.rules.wikilink = (tokens, index, _options, env) => {
    const { target, label, embed } = tokens[index].meta;
    const asset = resolveLink(target, env.from, env.attachments ?? []);
    if (embed) {
      if (/\.(?:png|jpe?g|gif|webp)(?:[#|]|$)/i.test(target))
        return image(target, label, env, "wiki");
      if (asset.status === "resolved")
        return `<a href="#" data-attachment="${escape(asset.path)}" data-attachment-fragment="${escape(fragment(target))}">첨부파일 · ${escape(label)}</a>`;
      const resolved = resolveLink(target, env.from, env.notes);
      const note = env.notes.find((n) => n.path === resolved.path);
      const visited = env.visited ?? [];
      if (!note)
        return `<span class="unresolved">삽입할 문서 없음 · ${escape(label)}</span>`;
      if (env.compactPreview)
        return `<a href="#" data-note="${escape(target)}">노트 · ${escape(label)}</a>`;
      if (visited.includes(note.path) || visited.length >= 4)
        return `<span class="embed-limit">순환/깊이 제한 · ${escape(label)}</span>`;
      return `<section class="note-embed" data-embed="${escape(note.path)}"><strong>${escape(note.title ?? note.path)}</strong>${renderMarkdown(note.content, env.notes, note.path, { ...env, visited: [...visited, note.path], readonly: true })}</section>`;
    }
    if (asset.status === "resolved")
      return `<a href="#" data-attachment="${escape(asset.path)}" data-attachment-fragment="${escape(fragment(target))}">${escape(label)}</a>`;
    const resolved = resolveLink(target, env.from, env.notes);
    return `<a href="#" class="wiki-link${resolved.status === "resolved" ? "" : " unresolved"}" data-note="${escape(target)}" title="${escape(target)}">${escape(label)}</a>`;
  };
  md.renderer.rules.image = (tokens, index, _options, env) =>
    image(tokens[index].attrGet("src") ?? "", tokens[index].content, env);
  md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    const token = tokens[index];
    const href = token.attrGet("href") ?? "";
    if (href.startsWith("#")) {
      let anchor = href.slice(1);
      try {
        anchor = decodeURIComponent(anchor);
      } catch {
        /* Keep malformed fragments inert. */
      }
      token.attrSet("data-anchor", anchor);
    } else if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("//")) {
      const asset = resolveLink(href, env.from, env.attachments ?? [], {
        kind: "markdown",
      });
      if (asset.status === "resolved") token.attrSet("data-attachment-fragment", fragment(href));
      token.attrSet(
        asset.status === "resolved" ? "data-attachment" : "data-note",
        asset.path ??
          (resolveLink(href, env.from, env.notes, { kind: "markdown" }).path ??
            href.split(/[\#^]/)[0]) + (href.match(/[\#^].*$/)?.[0] ?? ""),
      );
    } else token.attrSet("data-external", "true");
    token.attrSet("rel", "noopener noreferrer");
    return renderer.renderToken(tokens, index, options);
  };
  md.core.ruler.after("inline", "tasks_and_callouts", (state) => {
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      const inline = state.tokens[i + 2];
      if (
        token.type === "list_item_open" &&
        inline?.type === "inline" &&
        /^\[[ xX]\] /.test(inline.content)
      ) {
        const children = [];
        md.inline.parse(inline.content.slice(4), md, state.env, children);
        const input = new state.Token("html_inline", "", 0);
        input.content = `<input type="checkbox" class="task-checkbox" data-task-line="${(token.map?.[0] ?? 0) + (state.env.bodyOffset ?? 0)}"${/^\[[xX]\]/.test(inline.content) ? " checked" : ""}${state.env.readonly ? " disabled" : ""}> `;
        inline.children = [input, ...children];
      }
      if (token.type === "blockquote_open" && inline?.type === "inline") {
        const match = /^\[!([a-z]+)\][+-]?(?:[ \t]+([^\n]*))?(?:\n|$)/i.exec(
          inline.content,
        );
        if (match) {
          token.attrSet("class", "callout");
          token.attrSet("data-callout", match[1].toLowerCase());
          const children = [];
          md.inline.parse(
            inline.content.slice(match[0].length),
            md,
            state.env,
            children,
          );
          const title = new state.Token("html_inline", "", 0);
          title.content = `<strong class="callout-title">${escape(match[2] || match[1])}</strong><br>`;
          inline.children = [title, ...children];
        }
      }
    }
  });
}
