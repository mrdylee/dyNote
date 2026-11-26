export function stickyHeading(content) {
  for (const match of content.matchAll(/[^\r\n]+/g)) {
    const line = match[0];
    const title = line.trim().replace(/^(?:#{1,6}|[-+*]|\d+[.)])(?:\s+|$)/, "");
    if (title) return { title, end: match.index + line.length };
  }
  return { title: "Sticky Note", end: content.length };
}

export function stickyTitle(content) {
  return stickyHeading(content).title;
}
