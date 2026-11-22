import mammoth from "mammoth";
import { readPackage } from "./office-package.mjs";

const convertImage = mammoth.images.imgElement(async image => {
  if (!/^image\/(png|jpeg|gif|webp)$/i.test(image.contentType)) return {};
  return { src: `data:${image.contentType};base64,${await image.read("base64")}` };
});

function documentText(element) {
  if (element.type === "text") return element.value;
  if (element.type === "tab") return "\t";
  if (element.type === "break") return "\n";
  const suffix = element.type === "paragraph" ? "\n\n" : "";
  return (element.children ?? []).map(documentText).join("") + suffix;
}

export async function readWordContent(bytes, preview, cachedText) {
  try {
    const input = { buffer: await readPackage(bytes) };
    let content = cachedText;
    const { value: html } = await mammoth.convertToHtml(input, {
      externalFileAccess: false,
      includeEmbeddedStyleMap: false,
      convertImage: preview ? convertImage : () => [],
      transformDocument: document => {
        content ??= documentText(document);
        return document;
      },
    });
    return preview ? { content, html } : { content };
  } catch (cause) {
    throw new Error("Word 문서의 본문을 읽을 수 없습니다.", { cause });
  }
}
