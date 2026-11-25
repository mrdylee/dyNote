import { FILE_STORAGE_FOLDER } from "./vault.mjs";

export async function localOnlyFiles(git, acceptsPath) {
  // Matching ignored directories are returned once with a trailing slash, without listing their contents.
  const { stdout } = await git(["--no-optional-locks", "status", "--porcelain=v1", "--no-renames",
    "--ignored=matching", "--untracked-files=all", "-z", "--", FILE_STORAGE_FOLDER]);
  const files = [];
  for (const row of stdout.split("\0")) {
    const name = row.slice(3), ignored = row.startsWith("!! ");
    if ((!ignored && !row.startsWith("?? ")) || !name.startsWith(FILE_STORAGE_FOLDER + "/")) continue;
    const parts = name.split("/"), leaf = parts.at(-1);
    if (parts.some(part => part.startsWith(".") || part.startsWith("~$") || part === "node_modules") ||
        /^(desktop\.ini|thumbs\.db)$/i.test(leaf) || /(?:~|\.(?:tmp|temp|part|crdownload|swp))$/i.test(leaf)) continue;
    if (ignored) files.push({ name, message: name.endsWith("/") ? "Git 제외 규칙이 적용된 폴더" : "Git 제외 규칙이 적용된 파일" });
    else if (!name.endsWith("/") && !acceptsPath(name))
      files.push({ name, message: "동기화에서 지원하지 않는 파일 형식" });
  }
  return files;
}
