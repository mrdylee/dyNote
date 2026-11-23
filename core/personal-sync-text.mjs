import { captureLinkRanges } from "./copilot-journal-links.mjs";

const linesOf = text => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const decode = bytes => new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);

export async function textChoices(store, name, versions) {
  if (!/\.md$/i.test(name) || versions.length<2 || versions.some(v=>!v.blob)) return null;
  const ancestor=(await store.git(["merge-base","--octopus",...versions.map(v=>v.commit)],{allow:[0,1]})).stdout.trim();
  const baseEntry=(await store.tree(ancestor)).get(name);
  const base=baseEntry ?? await store.storeBytes(Buffer.alloc(0)), baseBytes=await store.blob(base.oid);
  const original=linesOf(decode(baseBytes)), edits=[];
  let total=baseBytes.length;
  for (const version of versions) {
    total+=(await store.git(["cat-file","-s",version.blob])).stdout.trim()*1;
    if(total>512*1024*1024) throw new Error("검토할 본문이 512 MiB를 넘습니다.");
    const bytes=await store.blob(version.blob);
    if(bytes.includes(0))return null;
    const lines=linesOf(decode(bytes));
    const diff=(await store.git(["diff","--no-ext-diff","--no-textconv","--unified=0","--text",base.oid,version.blob])).stdout;
    for(const match of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
      const count=Number(match[2] ?? 1), length=Number(match[4] ?? 1);
      const start=Number(match[1])-(count?1:0), index=Number(match[3])-(length?1:0);
      edits.push({start,end:start+count,chunk:lines.slice(index,index+length).join(""),version:version.commit});
    }
  }
  edits.sort((a,b)=>a.start-b.start || a.end-b.end);
  const groups=[];
  for (const edit of edits) {
    let group=groups.at(-1);
    if (!group || edit.start>group.end || (edit.start===group.end && group.start!==group.end && edit.start!==edit.end)) {
      group={start:edit.start,end:edit.end,items:[]};groups.push(group);
    }
    group.end=Math.max(group.end,edit.end);group.items.push(edit);
  }
  let at=0;const parts=[];
  for(const group of groups) {
    parts.push(original.slice(at,group.start).join(""));
    const alternatives={};
    for(const version of versions) {
      const mine=group.items.filter(e=>e.version===version.commit);
      if(!mine.length) continue;
      let cursor=group.start, output="";
      for(const edit of mine){output+=original.slice(cursor,edit.start).join("")+edit.chunk;cursor=edit.end;}
      alternatives[version.commit]=output+original.slice(cursor,group.end).join("");
    }
    const distinct=[...new Set(Object.values(alternatives))];
    parts.push(distinct.length===1 ? distinct[0] : {original:original.slice(group.start,group.end).join(""),alternatives});
    at=group.end;
  }
  parts.push(original.slice(at).join(""));
  return parts;
}

export function resolveText(parts, choices, defaultId) {
  let n=0;
  return parts.map(part=>{
    if(typeof part==="string") return part;
    const id=choices?.[n++] ?? defaultId;
    if (!Object.hasOwn(part.alternatives,id)) throw new Error("겹친 구간마다 남길 문장을 선택해 주세요.");
    return part.alternatives[id];
  }).join("");
}

// Only canonical marker/link/marker triplets belong to the collector.
export function mergeCaptureBlocks(base, left, right) {
  const split=source=>{
    const groups=captureLinkRanges(source), tokens=new Map();
    let plain=source;
    for(const {id,markers:[from,to],link} of groups.toReversed()) {
      if(from.to!==link.from || link.to!==to.from || tokens.has(id)) return null;
      tokens.set(id,source.slice(from.from,to.to).trimEnd());
      plain=plain.slice(0,from.from)+plain.slice(to.to);
    }
    return {plain, tokens};
  };
  const [b,l,r]=[base,left,right].map(split);
  if(!b || !l || !r || (!l.tokens.size && !r.tokens.size))return null;
  const clean=s=>s.replace(/(?:\r?\n)+$/,"");
  if(clean(l.plain)!==clean(r.plain) || (base && clean(l.plain)!==clean(b.plain)))return null;
  const merged=[];
  for(const id of [...new Set([...b.tokens.keys(),...l.tokens.keys(),...r.tokens.keys()])].sort()){
    const old=b.tokens.get(id),a=l.tokens.get(id),z=r.tokens.get(id);
    const value=a===z?a:a===old?z:z===old?a:undefined;
    if(a!==z && a!==old && z!==old)return null;
    if(value)merged.push(value);
  }
  const newline=left.includes("\r\n")?"\r\n":"\n";
  return [clean(l.plain),...merged].filter(Boolean).join(newline+newline)+newline;
}
