import { useEffect, useMemo, useRef, useState } from 'react';
import { ESS_DEVICES, essLabel, essMessage, noteEssLinks } from '../core/ess-links.mjs';
import './ess-viewer.css';

const viewerUrl='notes://ess/ess.html';
const viewerOrigin='notes://ess';

export default function EssViewer({ notes, target, onTarget, onOpen, onLink, disabled }) {
  const frame=useRef(null),latest=useRef(null),lock=useRef(false),alive=useRef(true);
  const [generation,setGeneration]=useState(0),[phase,setPhase]=useState('loading');
  const [search,setSearch]=useState(''),[path,setPath]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const selected=target??'ess-01/container';
  const matches=useMemo(()=>notes.filter(n=>noteEssLinks(n.content).includes(selected)),[notes,selected]);
  const choices=notes.filter(n=>!matches.some(m=>m.path===n.path)&&n.path.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  latest.current={notes,target,onTarget,onOpen};
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    setPhase('loading');
    const timer=setTimeout(()=>setPhase(old=>old==='loading'?'error':old),45000);
    const receive=event=>{
      const message=essMessage(event,frame.current?.contentWindow,viewerOrigin);
      if(!message)return;
      if(message.type==='error'){setPhase('error');return;}
      if(message.type==='ready'){
        clearTimeout(timer);setPhase('ready');
        if(latest.current.target)frame.current.contentWindow.postMessage({channel:'dynote-ess',type:'focus',target:latest.current.target},viewerOrigin);
      }
      if(message.type==='select'){
        const current=latest.current;
        current.onTarget(message.target);
        if(message.activate){const linked=current.notes.filter(n=>noteEssLinks(n.content).includes(message.target));if(linked.length===1)current.onOpen(linked[0].path);}
      }
    };
    window.addEventListener('message',receive);
    return()=>{clearTimeout(timer);window.removeEventListener('message',receive);};
  },[generation]);
  const focus=value=>{onTarget(value);frame.current?.contentWindow.postMessage({channel:'dynote-ess',type:'focus',target:value},viewerOrigin);};
  const save=async(note,linked)=>{
    if(lock.current||disabled)return;
    lock.current=true;setSaving(true);setError('');
    try {await onLink(note.path,selected,linked,note.revision);if(alive.current)setPath('');}
    catch(e){if(alive.current)setError(e.message);}
    finally{lock.current=false;if(alive.current)setSaving(false);}
  };
  return <section className="ess-workspace" aria-label="ESS LINK 3D">
    <header className="ess-heading"><div><h1>ESS LINK</h1><p>3D 오브젝트 · 장치를 선택해 노트와 연결하세요</p></div><button onClick={()=>setGeneration(v=>v+1)}>3D 다시 불러오기</button></header>
    <div className="ess-frame-wrap">
      <iframe key={generation} ref={frame} src={viewerUrl} title="ESS LINK 3D 뷰어" sandbox="allow-scripts allow-same-origin" allow="fullscreen"/>
      {phase!=='ready'&&<div className="ess-loading" role={phase==='error'?'alert':'status'}>{phase==='error'?'3D 모델을 열지 못했습니다. 3D 다시 불러오기를 눌러 주세요.':'ESS 모델을 불러오는 중…'}</div>}
    </div>
    <aside className="ess-note-links" aria-label="3D 관련 노트">
      <div className="ess-target-fields">
        <label>컨테이너<select aria-label="노트 연결 컨테이너" value={selected.split('/')[0]} disabled={phase!=='ready'} onChange={e=>focus(`${e.target.value}/${selected.split('/')[1]}`)}>{Array.from({length:6},(_,i)=>`ess-0${i+1}`).map(id=><option key={id} value={id}>{id.toUpperCase().replace('-',' ')}</option>)}</select></label>
        <label>부품<select aria-label="노트 연결 부품" value={selected.split('/')[1]} disabled={phase!=='ready'} onChange={e=>focus(`${selected.split('/')[0]}/${e.target.value}`)}>{ESS_DEVICES.map(id=><option key={id} value={id}>{essLabel(`ess-01/${id}`).split(' · ')[1]}</option>)}</select></label>
      </div>
      <strong>{essLabel(selected)} 관련 노트</strong>
      <p className="ess-link-hint">연결된 노트가 하나면 3D 장치 클릭으로 바로 엽니다.</p>
      {matches.length? <ul>{matches.map(n=><li key={n.path}><button onClick={()=>onOpen(n.path)}>{n.path}</button><button aria-label={`${n.path} ESS 연결 해제`} disabled={saving||disabled} onClick={()=>save(n,false)}>연결 해제</button></li>)}</ul>:<p>연결된 노트가 없습니다.</p>}
      <form onSubmit={e=>{e.preventDefault();const n=notes.find(n=>n.path===path);if(n)void save(n,true);}}>
        <label>노트 검색<input aria-label="ESS 연결 노트 검색" value={search} onChange={e=>{setSearch(e.target.value);setPath('');}} placeholder="노트 이름 또는 경로"/></label>
        <select aria-label="ESS 연결할 노트" value={path} onChange={e=>setPath(e.target.value)}><option value="">연결할 노트 선택</option>{choices.map(n=><option key={n.path} value={n.path}>{n.path}</option>)}</select>
        <button type="submit" disabled={!path||saving||disabled||phase!=='ready'}>{saving?'저장 중…':'노트 연결'}</button>
      </form>
      {error&&<p role="alert">{error}</p>}
    </aside>
  </section>;
}
