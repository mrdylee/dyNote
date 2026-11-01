import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";

export async function skillTools({ directories, canceled, emit }) {
  if (!directories.length) return [];
  const skills = new Map(), visited = new Set();
  const active = () => { if (canceled()) throw new Error("요청이 중지되었습니다."); };
  const read = async (directory, resource) => {
    if (!resource || path.isAbsolute(resource) || resource.includes("\\") || resource.split("/").includes("..")) throw new Error("스킬의 상대 리소스 경로를 확인해 주세요.");
    const file = await realpath(path.join(directory, resource));
    if (!file.startsWith(directory + path.sep)) throw new Error("선택한 스킬 밖의 리소스는 읽을 수 없습니다.");
    const info = await stat(file);
    if (!info.isFile() || info.size > 65536) throw new Error("스킬 텍스트는 64 KiB까지 읽을 수 있습니다.");
    const data = await readFile(file); active();
    if (data.length > 65536 || data.includes(0)) throw new Error("스킬 텍스트는 64 KiB까지 읽을 수 있습니다.");
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  };
  const scan = async directory => {
    active(); directory = await realpath(directory);
    if (visited.has(directory)) return;
    visited.add(directory);
    if (visited.size > 2048) throw new Error("스킬 폴더 범위가 너무 큽니다. 더 작은 폴더를 선택해 주세요.");
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some(entry => entry.name === "SKILL.md" && entry.isFile())) {
      const content = await read(directory, "SKILL.md"), frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      const document = frontmatter ? parseDocument(frontmatter[1]) : null;
      if (document?.errors.length) throw new Error(`스킬 속성을 확인해 주세요: ${path.basename(directory)}`);
      const metadata = document?.toJSON(), name = metadata?.name ?? path.basename(directory), description = metadata?.description ?? "";
      if (typeof name !== "string" || !name.trim() || name.length > 200 || typeof description !== "string" || description.length > 2000) throw new Error("스킬 이름과 설명을 확인해 주세요.");
      if (skills.has(name) && skills.get(name).directory !== directory) throw new Error(`스킬 이름이 중복됩니다: ${name}`);
      skills.set(name, { name, description, directory });
      if (skills.size > 200) throw new Error("스킬은 200개까지 연결할 수 있습니다. 더 작은 폴더를 선택해 주세요.");
      return;
    }
    for (const entry of entries) if (entry.isDirectory() && !entry.name.startsWith(".")) await scan(path.join(directory, entry.name));
  };
  for (const directory of directories) await scan(directory);
  let calls = 0;
  const tool = (name, description, properties, required, handler) => ({
    name, description, defer: "never", skipPermission: true,
    parameters: { type: "object", properties, required, additionalProperties: false },
    handler: async input => {
      try {
        active(); if (++calls > 32) throw new Error("스킬 사용 한도에 도달했습니다.");
        const result = await handler(input); active();
        return { resultType: "success", textResultForLlm: JSON.stringify(result) };
      } catch (error) { return { resultType: "failure", textResultForLlm: String(error.message).slice(0, 500) }; }
    },
  });
  return [
    tool("dynote_list_skills", "List the skills in folders explicitly selected by the user. Load a relevant skill with dynote_use_skill.", {}, [], () => ({ skills: [...skills.values()].map(({ name, description }) => ({ name, description })) })),
    tool("dynote_use_skill", "Load a selected skill's SKILL.md or a relative text resource. Follow relevant skill instructions using available note and MCP tools. This tool does not execute scripts.", { name: { type: "string" }, resource: { type: "string", description: "Optional path relative to this skill's folder; defaults to SKILL.md." } }, ["name"], async input => {
      const skill = skills.get(input?.name);
      if (!skill) throw new Error("연결된 스킬 이름을 선택해 주세요.");
      const resource = input.resource ?? "SKILL.md";
      if (typeof resource !== "string" || resource.length > 2048) throw new Error("스킬 리소스 경로를 확인해 주세요.");
      const content = await read(skill.directory, resource);
      emit("tool", { message: `스킬 읽음 · ${skill.name}` });
      return { name: skill.name, resource, content };
    }),
  ];
}
