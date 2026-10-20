import { createLinkIndex, resolvePath, normalizePath } from "./links.mjs";

export function buildGraph(notes, edges) {
  const nodes = notes.map((note) => ({ ...note, degree: 0 }));
  const index = new Map(nodes.map((node, i) => [node.path, i]));
  const adjacency = nodes.map(() => new Set());
  const incomingAdjacency = nodes.map(() => new Set());
  const outgoingAdjacency = nodes.map(() => new Set());
  const links = [], seen = new Set();
  for (const edge of edges) {
    const a = index.get(edge.source), b = index.get(edge.target);
    const key = `${a}:${b}`;
    if (a === undefined || b === undefined || a === b || seen.has(key)) continue;
    seen.add(key);
    links.push(a, b);
    nodes[a].degree++; nodes[b].degree++;
    adjacency[a].add(b); adjacency[b].add(a);
    outgoingAdjacency[a].add(b); incomingAdjacency[b].add(a);
  }
  return { nodes, links: Uint32Array.from(links), index, adjacency, incomingAdjacency, outgoingAdjacency };
}

export function selectGraph(graph, { path = "", tag = "", active, local = false, depth = 1, incoming = true, outgoing = true, neighborLinks = true, query = "", showTags = false, showAttachments = false, existingOnly = false, showOrphans = true } = {}) {
  const visible = graph.nodes.filter((node) => (showTags || node.type !== "tag") && (showAttachments || node.type !== "attachment") && (!existingOnly || node.type !== "missing"));
  if (visible.length !== graph.nodes.length) graph = buildGraph(visible, Array.from({ length: graph.links.length / 2 }, (_, i) => ({ source: graph.nodes[graph.links[2 * i]].path, target: graph.nodes[graph.links[2 * i + 1]].path })));
  const distances = new Map(), traversed = new Set();
  if (local && graph.index.has(active)) {
    const root = graph.index.get(active), queue = [root];
    distances.set(root, 0);
    for (let q = 0; q < queue.length; q++) {
      const a = queue[q], distance = distances.get(a);
      if (distance >= depth) continue;
      const visit = (b, source, target) => {
        if (!distances.has(b)) { distances.set(b, distance + 1); queue.push(b); }
        if (distances.get(b) === distance + 1) traversed.add(`${source}:${target}`);
      };
      if (outgoing) for (const b of graph.outgoingAdjacency[a]) visit(b, a, b);
      if (incoming) for (const b of graph.incomingAdjacency[a]) visit(b, b, a);
    }
  }
  const pathQuery = path.normalize("NFC").toLowerCase(), matches = graphQuery(query);
  const nodes = graph.nodes.filter((node, i) => (!local || distances.has(i)) && node.path.normalize("NFC").toLowerCase().includes(pathQuery) && matches(node) && (!tag || node.tags?.includes(tag)));
  const included = new Set(nodes.map((n) => graph.index.get(n.path)));
  const edges = [];
  for (let i = 0; i < graph.links.length; i += 2) {
    const a = graph.links[i], b = graph.links[i + 1];
    if (included.has(a) && included.has(b) && (!local || neighborLinks || traversed.has(`${a}:${b}`)))
      edges.push({ source: graph.nodes[a].path, target: graph.nodes[b].path });
  }
  const selected = buildGraph(nodes, edges);
  return showOrphans ? selected : buildGraph(selected.nodes.filter((node) => node.degree > 0), edges);
}

// Synthetic IDs cannot collide with legal file paths and are never sent to the vault.
export function buildVaultGraph(notes, edges, attachments = [], documents = []) {
  const files = [...notes, ...documents, ...attachments], index = createLinkIndex(files);
  const nodes = new Map([
    ...notes.map((n) => [n.path, { ...n, type: "note" }]),
    ...documents.map((n) => [n.path, { ...n, title: n.path.split("/").at(-1), type: "document" }]),
    ...attachments.map((n) => [n.path, { ...n, title: n.path.split("/").at(-1), type: "attachment" }]),
  ]);
  const relations = [...edges];
  for (const note of notes) {
    for (const raw of note.tags ?? []) {
      const tag = raw.replace(/^#/, "").normalize("NFC"), id = `\0tag:${tag}`;
      if (!tag) continue;
      if (!nodes.has(id)) nodes.set(id, { path: id, title: `#${tag}`, tags: [tag], type: "tag" });
      relations.push({ source: note.path, target: id });
    }
    for (const link of note.links ?? []) {
      const resolved = resolvePath(link.target, note.path, files, { kind: link.kind, index });
      if (resolved.status === "resolved") { relations.push({ source: note.path, target: resolved.path }); continue; }
      if (resolved.status === "ambiguous") continue;
      let target;
      try { target = decodeURIComponent(link.target.split(/[#^]/)[0]).trim(); } catch { continue; }
      if (!target || /^(?:[/\\]|[a-z][a-z0-9+.-]*:)/i.test(target) || target.includes("\0")) continue;
      const folder = note.path.includes("/") ? note.path.slice(0, note.path.lastIndexOf("/") + 1) : "";
      target = normalizePath((link.kind === "markdown" || target.startsWith(".") ? folder : "") + target);
      if (!target) continue;
      if (!/\.[a-z0-9]+$/i.test(target)) target += ".md";
      const id = `\0missing:${target.normalize("NFC").toLowerCase()}`;
      if (!nodes.has(id)) nodes.set(id, { path: id, title: target.replace(/\.md$/i, ""), type: "missing" });
      relations.push({ source: note.path, target: id });
    }
  }
  return buildGraph([...nodes.values()], relations);
}
const fold = (value) => String(value ?? "").normalize("NFC").toLowerCase();
export function graphQuery(raw) {
  const terms = [...raw.matchAll(/(-?)(?:(path|file|tag):)?("[^"]*"|[^\s]+)/gi)].map((m) => ({ negative: !!m[1], field: m[2]?.toLowerCase(), value: fold(m[3].replace(/^"|"$/g, "")) }));
  return (node) => terms.every(({ negative, field, value }) => {
    const path = fold(node.type === "missing" ? node.title : node.path);
    const tags = (node.tags ?? []).map((t) => fold(t).replace(/^#/, ""));
    const tag = value.replace(/^#/, "");
    const match = field === "tag" ? tags.some((t) => tag.endsWith("*") ? t.startsWith(tag.slice(0, -1)) : t === tag || t.startsWith(tag + "/"))
      : field === "path" ? path.includes(value)
      : field === "file" ? `${path.split("/").at(-1)} ${fold(node.title)}`.includes(value)
      : `${path} ${fold(node.title)}`.includes(value);
    return negative ? !match : match;
  });
}
export function graphColors(nodes, groups = []) {
  const rules = groups.filter((g) => g.query?.trim() && /^#[0-9a-f]{6}$/i.test(g.color)).map((g) => ({ matches: graphQuery(g.query), color: parseInt(g.color.slice(1), 16) }));
  return nodes.map((node) => rules.find((rule) => rule.matches(node))?.color ?? null);
}
export function graphReplayOrder(graph) {
  const times = graph.nodes.map((n) => {
    const values = [n.metadata?.ctime, n.metadata?.mtime].filter((t) => Number.isFinite(t) && t > 0);
    return values.length ? Math.min(...values) : Infinity;
  });
  const attached = (i) => ["tag", "missing", "attachment"].includes(graph.nodes[i].type);
  const ordered = graph.nodes.map((_, i) => i).filter((i) => !attached(i)).sort((a, b) => times[a] - times[b] || graph.nodes[a].path.localeCompare(graph.nodes[b].path));
  const ranks = new Uint32Array(graph.nodes.length); let rank = 0;
  ordered.forEach((index, i) => { if (i && (times[index] !== times[ordered[i - 1]] || !Number.isFinite(times[index]))) rank++; ranks[index] = rank; });
  for (let i = 0; i < graph.nodes.length; i++) {
    if (!attached(i)) continue;
    let first = Infinity;
    for (const neighbor of graph.adjacency[i]) if (!attached(neighbor)) first = Math.min(first, ranks[neighbor]);
    ranks[i] = Number.isFinite(first) ? first : ++rank;
  }
  return ranks;
}
