export function headingText(token) {
  if (!token) return "";
  if (token.type === "wikilink") return token.meta.label;
  if (token.children) return token.children.map(headingText).join("");
  if (token.type === "softbreak" || token.type === "hardbreak") return " ";
  return token.content;
}

export function headingId(text) {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-");
}
