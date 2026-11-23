import sniffHtmlEncoding from "html-encoding-sniffer";

export const attachmentMime = (name) =>
  ({
    __proto__: null,
    html: "text/html",
    htm: "text/html",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    pdf: "application/pdf",
    webm: "audio/webm",
    wav: "audio/wav",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
  })[name.match(/\.([^./\\]+)$/)?.[1]?.toLowerCase()];


export function decodeHtml(bytes) {
  try {
    const encoding = sniffHtmlEncoding(bytes, { defaultEncoding: "UTF-8" });
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    if (!text.includes("\0")) return text;
  } catch { /* Report the same encoding error for import and preview. */ }
  throw new Error("HTML 문자 인코딩을 읽을 수 없습니다. UTF-8로 저장하거나 올바른 charset을 지정해 주세요.");
}

export function validateAttachment(name, bytes) {
  const mime = attachmentMime(name);
  if (!mime || bytes.length > 25 * 1024 * 1024)
    throw new Error("25MB 이하의 HTML·이미지·PDF·오디오·Office 파일만 지원합니다.");
  if (mime === "text/html") {
    decodeHtml(bytes);
    return mime;
  }
  const signatures = {
    "image/png": () =>
      bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
    "image/jpeg": () =>
      bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    "image/gif": () => /^GIF8[79]a/.test(bytes.subarray(0, 6).toString()),
    "image/webp": () =>
      bytes.subarray(0, 4).toString() === "RIFF" &&
      bytes.subarray(8, 12).toString() === "WEBP",
    "application/pdf": () => bytes.subarray(0, 5).toString() === "%PDF-",
    "audio/webm": () => bytes.subarray(0, 4).equals(Buffer.from("1a45dfa3", "hex")),
    "audio/wav": () => bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WAVE",
    "audio/mpeg": () => bytes.subarray(0, 3).toString() === "ID3" || (bytes[0] === 255 && (bytes[1] & 224) === 224),
    "audio/ogg": () => bytes.subarray(0, 4).toString() === "OggS",
    "audio/mp4": () => bytes.subarray(4, 8).toString() === "ftyp",
  };
  const matches = /\.(xlsx|pptx)$/i.test(name) ? bytes.subarray(0, 4).equals(Buffer.from("504b0304", "hex")) : signatures[mime]();
  if (!matches)
    throw new Error("확장자와 파일 형식이 일치하지 않습니다.");
  return mime;
}
