import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ExternalDocuments } from "../core/external-documents.mjs";

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-readable-files-")));
  const cache = path.join(root, "cache");
  await mkdir(cache);
  const documents = new ExternalDocuments(cache);
  t.after(async () => { await documents.dispose(); await rm(root, { recursive: true, force: true }); });
  return { root, cache, documents };
}

test("opens Markdown and UTF-8 text without changing source bytes or interpreting markup", async t => {
  const { root, cache, documents } = await fixture(t);
  for (const [name, content, kind] of [["한글.MD", "# 요구사항\n\n**원본**\n", "markdown"],
    ["README", "<script>window.bad=true</script>\n한글 텍스트", "text"],
    ["원본.json", '{"hello":"안녕"}', "text"], ["source.py", 'print("test")', "text"]]) {
    const file = path.join(root, name), bytes = Buffer.from(content);
    await writeFile(file, bytes);
    const opened = await documents.open(file);
    assert.equal(opened.kind, kind);
    assert.equal(opened.content, content);
    assert.deepEqual(await readFile(file), bytes);
    assert.equal(opened.canOpenSource, /\.(md|json)$/i.test(name));
    if (opened.canOpenSource) assert.equal(await documents.sourcePath(opened.id), file);
    else await assert.rejects(documents.sourcePath(opened.id), /편집기/);
  }
  assert.equal((await readdir(cache)).length, 4);
});

test("opens all existing attachment extensions as verified binary previews", async t => {
  const { root, documents } = await fixture(t);
  const samples = [
    ["png", "89504e470d0a1a0a", "image"], ["jpg", "ffd8ff", "image"], ["jpeg", "ffd8ff", "image"],
    ["gif", Buffer.from("GIF89a").toString("hex"), "image"],
    ["webp", Buffer.from("RIFF0000WEBP").toString("hex"), "image"],
    ["pdf", Buffer.from("%PDF-1.7").toString("hex"), "pdf"], ["webm", "1a45dfa3", "audio"],
    ["wav", Buffer.from("RIFF0000WAVE").toString("hex"), "audio"],
    ["mp3", Buffer.from("ID3").toString("hex"), "audio"], ["ogg", Buffer.from("OggS").toString("hex"), "audio"],
    ["m4a", Buffer.from("0000ftyp").toString("hex"), "audio"],
  ];
  for (const [extension, hex, kind] of samples) {
    const file = path.join(root, "sample." + extension), bytes = Buffer.from(hex, "hex");
    await writeFile(file, bytes);
    const opened = await documents.open(file);
    assert.equal(opened.kind, kind, extension);
    assert.ok(opened.mime);
    assert.deepEqual(Buffer.from(opened.bytes), bytes);
    assert.equal(await documents.sourcePath(opened.id), file);
    assert.deepEqual(await readFile(file), bytes);
  }
});

test("validates Canvas and Bases instead of exposing the current vault", async t => {
  const { root, documents } = await fixture(t);
  for (const [extension, content] of [["canvas", '{"nodes":[],"edges":[]}'], ["base", "views:\n  - type: table\n    name: 목록\n"]]) {
    const file = path.join(root, "sample." + extension);
    await writeFile(file, content);
    const opened = await documents.open(file);
    assert.equal(opened.kind, extension);
    assert.equal(opened.path, path.basename(file));
    assert.equal(opened.content, content);
    await writeFile(file, "invalid: [");
    await assert.rejects(documents.read(opened.id, opened.revision));
  }
});

test("rejects disguised attachments, binary files and invalid UTF-8 without leaving copies", async t => {
  const { root, cache, documents } = await fixture(t);
  for (const [name, bytes] of [["fake.png", Buffer.from("<html/>")], ["binary.bin", Buffer.from([0,1,2])],
    ["bad.txt", Buffer.from([255,254,255])]]) {
    const file = path.join(root, name);
    await writeFile(file, bytes);
    await assert.rejects(documents.open(file));
    assert.deepEqual(await readFile(file), bytes);
  }
  assert.deepEqual(await readdir(cache), []);
});

test("preserves Markdown's unlimited size and the existing structured/media size limits", async t => {
  const { root, documents } = await fixture(t);
  const markdown = path.join(root, "large.md"), content = "# Large\n" + "a".repeat(25 * 1024 * 1024);
  await writeFile(markdown, content);
  assert.equal((await documents.open(markdown)).content.length, content.length);
  for (const [extension, bytes, message] of [["canvas", 8 * 1024 * 1024 + 1, /8MB/], ["base", 8 * 1024 * 1024 + 1, /8MB/], ["txt", 25 * 1024 * 1024 + 1, /25MB/]]) {
    const file = path.join(root, "large." + extension);
    await writeFile(file, ""); await truncate(file, bytes);
    await assert.rejects(documents.open(file), message);
  }
});
