const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function pathPatterns(filters) {
  return filters
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const pattern = value.endsWith("/") ? value + "**" : value;
      const tokens = pattern.match(/\*\*\/|\*\*|\*|\?|[^*?]+/g);
      const wildcards = { "**/": "(?:.*/)?", "**": ".*", "*": "[^/]*", "?": "[^/]" };
      return new RegExp(
        (value.includes("/") ? "^" : "(?:^|/)") +
          tokens.map((token) => wildcards[token] ?? escape(token)).join("") +
          "$",
        "iu",
      );
    });
}

export function searchWorkspace(files, { query, regexp, caseSensitive, wholeWord, include, exclude }) {
  if (!query) return [];
  let source = regexp ? query : escape(query);
  if (wholeWord) source = "(?<![\\p{L}\\p{M}\\p{N}_])(?:" + source + ")(?![\\p{L}\\p{M}\\p{N}_])";
  const expression = new RegExp(source, caseSensitive ? "gu" : "giu");
  const included = pathPatterns(include),
    excluded = pathPatterns(exclude);
  const groups = [];
  for (const { key, path, content } of files) {
    if (
      (included.length && !included.some((pattern) => pattern.test(path))) ||
      excluded.some((pattern) => pattern.test(path))
    )
      continue;
    const matches = [];
    const lines = content.split(/(\r\n|\r|\n)/);
    let start = 0;
    for (let i = 0; i < lines.length; i += 2) {
      const line = lines[i];
      for (const match of line.matchAll(expression)) {
        matches.push({
          from: start + match.index,
          line: i / 2,
          column: match.index,
          text: match[0],
          before: line.slice(Math.max(0, match.index - 35), match.index),
          after: line.slice(match.index + match[0].length, match.index + match[0].length + 55),
          captures: match.slice(1),
          named: match.groups,
        });
      }
      start += line.length + (lines[i + 1]?.length ?? 0);
    }
    if (matches.length) groups.push({ key, matches });
  }
  return groups;
}

export function replacementText(match, value, regexp) {
  if (!regexp) return value;
  return value.replace(/\$(\$|&|[1-9]\d?|<([^>]+)>)/g, (token, code, name) => {
    if (code === "$") return "$";
    if (code === "&") return match.text;
    if (name !== undefined) {
      if (!match.named) return token;
      return Object.hasOwn(match.named, name) ? (match.named[name] ?? "") : "";
    }
    if (Number(code) <= match.captures.length) return match.captures[Number(code) - 1] ?? "";
    if (code.length === 2 && Number(code[0]) <= match.captures.length)
      return (match.captures[Number(code[0]) - 1] ?? "") + code[1];
    return token;
  });
}

export function replaceMatches(content, matches, value, regexp) {
  let start = 0;
  const parts = [];
  for (const match of matches) {
    parts.push(content.slice(start, match.from), replacementText(match, value, regexp));
    start = match.from + match.text.length;
  }
  return parts.join("") + content.slice(start);
}
