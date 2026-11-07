import JSZip from "jszip";
import mammoth from "mammoth";
import yauzl from "yauzl";

async function readPackage(bytes) {
  const zip = await yauzl.fromBufferPromise(bytes, { strictFileNames: true });
  const validated = new JSZip();
  try {
    if (zip.entryCount > 4096) throw new Error("Too many package entries");
    let expandedBytes = 0;
    let actualBytes = 0;
    for await (const entry of zip.eachEntry()) {
      expandedBytes += entry.uncompressedSize;
      if (expandedBytes > 100 * 1024 * 1024) throw new Error("Word package is too large");
      const stream = await zip.openReadStreamPromise(entry);
      const chunks = [];
      for await (const chunk of stream) {
        actualBytes += chunk.length;
        if (actualBytes > 100 * 1024 * 1024) throw new Error("Word package is too large");
        chunks.push(chunk);
      }
      validated.file(entry.fileName, Buffer.concat(chunks), { binary: true, createFolders: false });
    }
    // The converter receives only entries read and bounded by the same ZIP reader.
    return await validated.generateAsync({ type: "nodebuffer" });
  } finally {
    zip.close();
  }
}

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
