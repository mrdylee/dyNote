import { finished } from "node:stream/promises";
import mammoth from "mammoth";
import yauzl from "yauzl";

async function validatePackage(bytes) {
  const zip = await yauzl.fromBufferPromise(bytes, { strictFileNames: true });
  try {
    if (zip.entryCount > 4096) throw new Error("Too many package entries");
    let expandedBytes = 0;
    for await (const entry of zip.eachEntry()) {
      expandedBytes += entry.uncompressedSize;
      if (expandedBytes > 100 * 1024 * 1024) throw new Error("Word package is too large");
      // Check the actual inflated size before passing the archive to the parser.
      const stream = await zip.openReadStreamPromise(entry);
      stream.resume();
      await finished(stream, { cleanup: true });
    }
  } finally {
    zip.close();
  }
}

const convertImage = mammoth.images.imgElement(async image => {
  if (!/^image\/(png|jpeg|gif|webp)$/i.test(image.contentType)) return {};
  return { src: `data:${image.contentType};base64,${await image.read("base64")}` };
});

export async function readWordContent(bytes, preview, cachedText) {
  try {
    await validatePackage(bytes);
    const input = { buffer: bytes };
    const content = cachedText ?? (await mammoth.extractRawText(input)).value;
    if (!preview) return { content };
    const { value: html } = await mammoth.convertToHtml(input, {
      externalFileAccess: false,
      includeEmbeddedStyleMap: false,
      convertImage,
    });
    return { content, html };
  } catch (cause) {
    throw new Error("Word 문서의 본문을 읽을 수 없습니다.", { cause });
  }
}
