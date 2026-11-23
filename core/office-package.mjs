import JSZip from "jszip";
import yauzl from "yauzl";

export async function readPackage(bytes, requiredPart) {
  const zip = await yauzl.fromBufferPromise(bytes, { strictFileNames: true });
  const validated = new JSZip();
  try {
    if (zip.entryCount > 4096) throw new Error("Too many package entries");
    let expandedBytes = 0;
    let actualBytes = 0;
    for await (const entry of zip.eachEntry()) {
      expandedBytes += entry.uncompressedSize;
      if (expandedBytes > 100 * 1024 * 1024) throw new Error("Office package is too large");
      const stream = await zip.openReadStreamPromise(entry);
      const chunks = [];
      for await (const chunk of stream) {
        actualBytes += chunk.length;
        if (actualBytes > 100 * 1024 * 1024) throw new Error("Office package is too large");
        chunks.push(chunk);
      }
      validated.file(entry.fileName, Buffer.concat(chunks), { binary: true, createFolders: false });
    }
    if (requiredPart && !validated.file(requiredPart)) throw new Error("Missing Office document part");
    // The converter receives only entries read and bounded by the same ZIP reader.
    return await validated.generateAsync({ type: "nodebuffer" });
  } finally {
    zip.close();
  }
}

export async function officePreview(kind, bytes) {
  try {
    const part = kind === "xlsx" ? "xl/workbook.xml" : "ppt/presentation.xml";
    return { kind, bytes: await readPackage(bytes, part) };
  } catch {
    return { kind, previewError: "문서를 미리 볼 수 없습니다. 앱에서 원본을 열어 확인해 주세요." };
  }
}
