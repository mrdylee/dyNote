export function stickyTitle(content) {
  for (const [line] of content.matchAll(/[^\r\n]+/g)) {
    const title = line.trim().replace(/^(?:#{1,6}|[-+*]|\d+[.)])(?:\s+|$)/, "");
    if (title) return title;
  }
  return "Sticky Note";
}
