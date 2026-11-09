export const attachmentMime = (name) =>
  ({
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    webm: "audio/webm",
    wav: "audio/wav",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
  })[name.split(".").at(-1)?.toLowerCase()];


export function validateAttachment(name, bytes) {
  const mime = attachmentMime(name);
  if (!mime || bytes.length > 25 * 1024 * 1024)
    throw new Error("25MB 이하의 이미지·PDF·오디오만 지원합니다.");
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
  if (!signatures[mime]())
    throw new Error("확장자와 파일 형식이 일치하지 않습니다.");
  return mime;
}
