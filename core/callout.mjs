export const calloutHeader = /^\[!([a-z]+)\][+-]?(?:[ \t]+([^\n]*))?(?:\n|$)/i;

export function startsCallout(node, firstLine) {
  return node.name === "Paragraph" && node.parent?.name === "Blockquote"
    && node.prevSibling?.name === "QuoteMark" && !node.prevSibling.prevSibling && calloutHeader.test(firstLine);
}
