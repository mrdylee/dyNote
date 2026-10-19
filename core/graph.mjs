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

export function selectGraph(graph, { path = "", tag = "", active, local = false, depth = 1, incoming = true, outgoing = true, neighborLinks = true } = {}) {
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
  const query = path.normalize("NFC").toLowerCase();
  const nodes = graph.nodes.filter((node, i) => (!local || distances.has(i)) && node.path.normalize("NFC").toLowerCase().includes(query) && (!tag || node.tags?.includes(tag)));
  const included = new Set(nodes.map((n) => graph.index.get(n.path)));
  const edges = [];
  for (let i = 0; i < graph.links.length; i += 2) {
    const a = graph.links[i], b = graph.links[i + 1];
    if (included.has(a) && included.has(b) && (!local || neighborLinks || traversed.has(`${a}:${b}`)))
      edges.push({ source: graph.nodes[a].path, target: graph.nodes[b].path });
  }
  return buildGraph(nodes, edges);
}
