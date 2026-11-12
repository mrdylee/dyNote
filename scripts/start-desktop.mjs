import { spawn, execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const electron = createRequire(import.meta.url)("electron");
const exec = promisify(execFile);

export async function desktopExecutable() {
  if (process.platform !== "darwin") return electron;
  const [metadata, icon, launcher] = await Promise.all([
    readFile(path.join(root, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "branding/dynote.icns")),
    readFile(fileURLToPath(import.meta.url)),
  ]);
  const key = createHash("sha256").update(metadata.version).update(metadata.devDependencies.electron).update(icon).update(launcher).digest("hex").slice(0, 16);
  const cache = path.join(tmpdir(), "dynote-desktop");
  const directory = path.join(cache, key);
  const executable = path.join(directory, "Dynote.app/Contents/MacOS/Dynote");
  try { await access(executable); return executable; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  await mkdir(cache, { recursive: true });
  const staging = await mkdtemp(path.join(cache, ".prepare-"));
  const bundle = path.join(staging, "Dynote.app");
  try {
    await cp(path.resolve(electron, "../../.."), bundle, {
      recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
    });
    const renameBundle = async (appPath, previous, name, identifier) => {
      for (const [key, value] of Object.entries({
        CFBundleName: name, CFBundleDisplayName: name,
        CFBundleExecutable: name, CFBundleIdentifier: identifier,
      })) await exec("plutil", ["-replace", key, "-string", value, path.join(appPath, "Contents/Info.plist")]);
      await rename(path.join(appPath, "Contents/MacOS", previous), path.join(appPath, "Contents/MacOS", name));
    };
    await renameBundle(bundle, "Electron", "Dynote", "com.electron.dynote.dev");
    await exec("/usr/libexec/PlistBuddy", [
      "-c", "Set :CFBundleIconFile dynote.icns",
      "-c", `Set :CFBundleShortVersionString ${metadata.version}`,
      "-c", `Set :CFBundleVersion ${metadata.version}`,
      path.join(bundle, "Contents/Info.plist"),
    ]);
    const resources = path.join(bundle, "Contents/Resources");
    await rename(path.join(resources, "electron.icns"), path.join(resources, "dynote.icns"));
    await writeFile(path.join(resources, "dynote.icns"), icon);
    const frameworks = path.join(bundle, "Contents/Frameworks");
    for (const entry of await readdir(frameworks)) {
      if (!entry.startsWith("Electron Helper") || !entry.endsWith(".app")) continue;
      const previous = entry.slice(0, -4), name = previous.replace("Electron", "Dynote");
      await renameBundle(path.join(frameworks, entry), previous, name, "com.electron.dynote.dev.helper");
      await rename(path.join(frameworks, entry), path.join(frameworks, `${name}.app`));
    }
    // The default development entry point is retained; only this private runtime is renamed.
    await exec("xattr", ["-rd", "com.apple.FinderInfo", bundle]);
    await exec("codesign", ["--force", "--deep", "--sign", "-", bundle]);
    await exec("codesign", ["--verify", "--deep", "--strict", bundle]);
    try { await rename(staging, directory); }
    catch (error) { if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error; }
    return executable;
  } finally { await rm(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const child = spawn(await desktopExecutable(), [root, ...process.argv.slice(2)], { stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM", "SIGUSR2"]) process.once(signal, () => child.kill(signal));
  child.on("error", error => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code ?? 1; });
}
