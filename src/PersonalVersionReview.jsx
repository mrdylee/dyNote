import { useEffect, useState } from "react";

function copyPath(name, id) {
  const dot=name.lastIndexOf(".");
  return name.slice(0,dot)+" ("+id.slice(0,8)+")"+name.slice(dot);
}

export default function PersonalVersionReview({path, count, action, onClose}) {
  const [rows,setRows]=useState([]),[basis,setBasis]=useState([]),[current,setCurrent]=useState(null);
  const [selected,select]=useState(""),[hunks,setHunks]=useState([]),[picks,setPicks]=useState({});
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[limit,setLimit]=useState(50);
  const [both,setBoth]=useState(false),[names,setNames]=useState({}),[reload,setReload]=useState(0);
  useEffect(()=>{
    let active=true;
    async function load(){
      const initial=await action({action:"versions",path}),all=[...initial.versions];
      for(let skip=50;skip<Math.min(limit,initial.basis.length);skip+=50) {
        const page=await action({action:"versions",path,skip});
        if(JSON.stringify(initial.basis)!==JSON.stringify(page.basis)) {if(active)setReload(n=>n+1);return;}
        all.push(...page.versions);
      }
      const intervals=await action({action:"hunks",path});
      if(active) {
        setRows(old=>[...old.filter(v=>all.some(a=>a.commit===v.commit)),...all.filter(v=>!old.some(o=>o.commit===v.commit))]);
        setBasis(initial.basis);setCurrent(initial.current);setHunks(intervals);
        select(old=>initial.basis.includes(old)?old:"");
      }
    }
    load().catch(e=>{if(active)setError(e.message);});return ()=>{active=false;};
  },[path,count,limit,reload]);
  async function apply(){
    setBusy(true);setError("");
    try {
      const copies=both?Object.fromEntries(rows.filter(v=>v.commit!==selected && v.blob).map(v=>[v.commit,names[v.commit] ?? copyPath(path,v.commit)])):undefined;
      await action({action:"resolve",path,basis,commit:selected,options:{hunks:hunks.map((h,i)=>picks[i] ?? selected),copies}});
      onClose();
    } catch(e){setError(e.message);setReload(n=>n+1);} finally {setBusy(false);}
  }
  async function download(v){
    try {
      const bytes=await action({action:"preview",path,commit:v.commit});
      const url=URL.createObjectURL(new Blob([bytes])),link=document.createElement("a");
      link.download=copyPath(path.split("/").pop(),v.commit);link.href=url;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
    } catch(e){setError(e.message);}
  }
  return <section className="settings-section"><h3>{path}</h3>
    <fieldset disabled={busy}><legend>검토할 버전 {basis.length}개</legend>
      {rows.map(v=><div key={v.commit}><label><input type="radio" name="version" checked={selected===v.commit} onChange={()=>select(v.commit)} />
        {hunks[0]?.alternatives[v.commit]?.trim().slice(0,120) || (v.blob?"파일 수정":"파일 삭제")} · {v.device || v.author} · {new Date(v.time).toLocaleString()}
        {v.blob===current?" · 현재 상태":""}</label>
        {v.blob && <button onClick={()=>download(v)}>이 버전 저장</button>}</div>)}
      {rows.length<basis.length && <button onClick={()=>setLimit(n=>n+50)}>이전 버전 더 보기</button>}
    </fieldset>
    {hunks.map((h,i)=><fieldset key={i}><legend>겹친 문장 {i+1}</legend><details><summary>공통 원문</summary><pre>{h.original}</pre></details>
      {rows.filter(v=>Object.hasOwn(h.alternatives,v.commit)).map(v=><label key={v.commit}><input type="radio" name={"hunk"+i} checked={(picks[i] ?? selected)===v.commit} onChange={()=>{setPicks(old=>({...old,[i]:v.commit}));if(!selected)select(v.commit);}}/>{h.alternatives[v.commit] || "(삭제)"}</label>)}</fieldset>)}
    {!/\.md$/i.test(path) && selected && <><label><input type="checkbox" checked={both} onChange={e=>setBoth(e.target.checked)}/>모두 유지</label>
      {both && rows.filter(v=>v.blob && v.commit!==selected).map(v=><label key={v.commit}>{v.device || v.author} 사본 경로<input value={names[v.commit] ?? copyPath(path,v.commit)} onChange={e=>setNames(old=>({...old,[v.commit]:e.target.value}))}/></label>)}</>}
    {error && <p role="alert">{error}</p>}
    <div className="settings-actions"><button className="primary-button" disabled={busy || !selected || (both && rows.length!==basis.length)} onClick={apply}>선택한 버전으로 적용</button>
      <button disabled={busy} onClick={onClose}>나중에</button></div>
  </section>;
}
