import path from "node:path";

export function assetPath(input, root) {
  const url = new URL(input);
  const decoded = decodeURIComponent(url.pathname);
  if (
    url.protocol !== "notes:" ||
    url.host !== "app" ||
    /[\\\0]/.test(decoded) ||
    decoded.split("/").some((p) => p.startsWith(".")) ||
    !/\.(?:html|js|css|svg|woff2)$/.test(decoded)
  )
    throw new Error("Forbidden asset");
  const file = path.resolve(root, "." + decoded);
  if (!file.startsWith(path.resolve(root) + path.sep))
    throw new Error("Forbidden asset");
  return file;
}

export function trustedFrame(url, isMainFrame) {
  return isMainFrame && url === "notes://app/index.html";
}

export function safeExternalUrl(input) {
  if (typeof input !== "string" || /[\x00-\x20]/.test(input))
    throw new Error("허용되지 않는 외부 주소입니다.");
  const url = new URL(input);
  if (
    !["https:", "http:", "mailto:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("허용되지 않는 외부 주소입니다.");
  return url.href;
}
