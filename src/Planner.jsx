import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, CalendarDays, Check, CheckCheck, ChevronLeft, CircleHelp, ClipboardPaste, FileImage, Flag, LayoutDashboard, Link2, LoaderCircle, Plus, Sparkles, Undo2, X } from 'lucide-react';
import { BOARD_PATH, EVIDENCE_KINDS, capturePrompt, dayNumber, evidenceIssues, ideasPrompt, normalizeItem, parseCapture, parseIdeas, readBoard, registerItems, reschedule, validDate, writeBoard } from '../core/planner.mjs';
import { localDate } from '../core/periodic-notes.mjs';
import './planner.css';

const invoke = async promise => {const r=await promise;if(!r.ok)throw new Error(r.error);return r.value;};
const sourceUrl = (vaultId,path) => `notes://vault/${encodeURIComponent(vaultId)}/${path.split('/').map(encodeURIComponent).join('/')}`;
const statuses={planned:'예정',active:'진행 중',blocked:'대기',done:'완료'};
const dates = item => item.start ? `${item.start}${item.end&&item.end!==item.start?` → ${item.end}`:''}` : item.end ? `마감 ${item.end}` : '날짜 확인 필요';
const tone = value => ({Link:'mint',BMS:'lilac',PACK:'sand'}[value] ?? ['mint','lilac','sand'][[...value].reduce((a,c)=>a+c.charCodeAt(0),0)%3]);

function SourceImage({source,vaultId}) {
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[source?.path]);
  if(!source?.path)return null;
  return <div className="planner-source">
    <div className="planner-caption"><FileImage size={15}/> 원본 캡처 <span>근거와 함께 확인하세요</span></div>
    {failed?<p role="alert">원본 이미지를 찾을 수 없습니다. 첨부파일 경로를 확인해 주세요.</p>:<div className="planner-image-wrap">
      <img src={sourceUrl(vaultId,source.path)} alt="일정 원본 캡처" onError={()=>setFailed(true)}/>
      {source.bbox&&<div className="planner-image-box" title="AI가 추정한 위치" style={{left:`${source.bbox[0]*100}%`,top:`${source.bbox[1]*100}%`,width:`${source.bbox[2]*100}%`,height:`${source.bbox[3]*100}%`}}/>}
    </div>}
    {source.text&&<blockquote>{source.text}</blockquote>}
    {source.bbox&&<small>표시 영역은 AI가 추정한 위치입니다.</small>}
  </div>;
}

function ItemFields({item,onChange,prefix=''}) {
  const change=(key,value)=>onChange({...item,[key]:value});
  return <div className="planner-fields">
    <label className="full">제목<input aria-label={`${prefix}제목`} maxLength={200} value={item.title} onChange={e=>change('title',e.target.value)} placeholder="예: DV 준비 검토"/></label>
    <label>대상<input aria-label={`${prefix}대상`} list="planner-targets" maxLength={80} value={item.target} onChange={e=>change('target',e.target.value)} placeholder="Link, BMS, PACK…"/></label>
    <label>단계<input aria-label={`${prefix}단계`} list="planner-stages" maxLength={80} value={item.stage} onChange={e=>change('stage',e.target.value)} placeholder="CV, DV, PD, PV…"/></label>
    <label>시작일<input aria-label={`${prefix}시작일`} type="date" min="1900-01-01" max="2200-12-31" value={item.start} onChange={e=>change('start',e.target.value)}/></label>
    <label>종료·마감일<input aria-label={`${prefix}종료일`} type="date" min="1900-01-01" max="2200-12-31" value={item.end} onChange={e=>change('end',e.target.value)}/></label>
    <label>진행 상태<select aria-label={`${prefix}진행 상태`} value={item.status} onChange={e=>change('status',e.target.value)}>{Object.entries(statuses).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <label>확인할 내용<input aria-label={`${prefix}확인할 내용`} value={item.uncertainty} onChange={e=>change('uncertainty',e.target.value)} placeholder="연도 미표기, 날짜 확인 등"/></label>
  </div>;
}

export default function Planner({api,vaultId,notes,onSave,onImported,onOpen,disabled=false}) {
  const document=notes.find(n=>n.path===BOARD_PATH);
  const parsed=useMemo(()=>{try{return {board:readBoard(document?.content),error:''};}catch(e){return {board:{version:1,items:[]},error:e.message};}},[document?.content]);
  const board=parsed.board;
  const [view,setView]=useState('today'),[filter,setFilter]=useState('전체'),[notice,setNotice]=useState(''),[error,setError]=useState('');
  const [capture,setCapture]=useState(null),[review,setReview]=useState(null),[reviewIndex,setReviewIndex]=useState(0),[selected,setSelected]=useState([]);
  const [draft,setDraft]=useState(null),[question,setQuestion]=useState('이 일정까지 무엇을 준비하면 좋을까?'),[ideas,setIdeas]=useState([]);
  const [auth,setAuth]=useState(null),[model,setModel]=useState(''),[working,setWorking]=useState(''),[saving,setSaving]=useState(false),[undo,setUndo]=useState(null);
  const [taskText,setTaskText]=useState(''),[evidencePath,setEvidencePath]=useState(''),[evidenceKind,setEvidenceKind]=useState('requirement');
  const request=useRef(null),fileInput=useRef(null),alive=useRef(true),saveLock=useRef(false),draftOrigin=useRef(null);
  const today=localDate(), targets=[...new Set(board.items.map(i=>i.target).filter(Boolean))];
  const locked=saving||disabled||!!parsed.error;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(request.current)api.copilotCancel({requestId:request.current.id});};},[api]);
  useEffect(()=>api.onCopilotEvent(event=>{
    if(event.type==='auth'){setNotice(event.message||'GitHub 연결 상태가 바뀌었습니다. 연결 확인을 눌러 주세요.');if(event.phase==='error')setError(event.message);return;}
    const job=request.current;if(!job||event.requestId!==job.id)return;
    if(event.type==='done'){
      request.current=null;setWorking('');
      try { if(job.kind==='capture'){const rows=parseCapture(event.content,job.source);setReview(rows);setSelected(rows.map(r=>r.id));setReviewIndex(0);if(!rows.length)setNotice('이미지에서 일정을 찾지 못했습니다. 직접 추가하거나 다른 캡처를 사용하세요.');}
        else setIdeas(parseIdeas(event.content));
      }catch(e){setError(e.message);}
    } else if(event.type==='error'||event.type==='canceled'){request.current=null;setWorking('');if(event.type==='error')setError(event.error);}
  }),[api]);
  const connectStatus=async()=>{try{setError('');const result=await invoke(api.copilotStatus());if(!alive.current)return;setAuth(result);setModel(old=>result.models.some(m=>m.id===old)?old:(result.models.find(m=>m.vision)?.id??result.models[0]?.id??''));if(result.error)setError(result.error);return result;}catch(e){if(alive.current)setError(e.message);}};
  const loadImage=async file=>{
    if(!file||working||saving)return;
    if(draft){setError('일정 편집을 저장하거나 닫은 뒤 새 캡처를 붙여넣어 주세요.');return;}
    try{
      setError('');setWorking('import');
      if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>6*1024*1024)throw new Error('PNG·JPEG·WebP 이미지 한 장, 최대 6MB까지 사용할 수 있습니다.');
      const bytes=new Uint8Array(await file.arrayBuffer());
      const imported=await invoke(api.importAttachment({vaultId,name:file.name||'capture.png',bytes}));
      if(!alive.current)return;
      onImported(imported);
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('이미지를 읽을 수 없습니다.'));reader.readAsDataURL(file);});
      if(!alive.current)return;
      const nextCapture={source:{path:imported.path,hash:imported.revision,text:'',bbox:null},image:{mimeType:file.type,data}};
      setCapture(nextCapture);
      setReview(null);setDraft(null);setIdeas([]);setWorking('');
      const status=await connectStatus();
      const visionModel=status?.models?.find(m=>m.id===model&&m.vision)??status?.models?.find(m=>m.vision);
      if(alive.current&&status?.authenticated&&visionModel)await runAI('capture',{capture:nextCapture,model:visionModel.id});
    }catch(e){if(alive.current){setError(e.message);setWorking('');}}
  };
  const runAI=async(kind,override=null)=>{
    if(request.current||(working&&!override))return;
    const selectedModel=override?.model??model, inputCapture=override?.capture??capture;
    try{
      setError('');
      if(!selectedModel)throw new Error('AI 연결을 확인하고 모델을 선택해 주세요.');
      if(kind==='capture'&&!inputCapture)throw new Error('먼저 캡처를 붙여넣어 주세요.');
      if(kind==='ideas'&&!question.trim())throw new Error('고민을 한 줄 입력해 주세요.');
      const id=crypto.randomUUID();request.current={id,kind,source:inputCapture?.source};setWorking(kind);
      await invoke(api.copilotSend({requestId:id,vaultId,model:selectedModel,mode:'chat',history:[],references:[],context:kind==='ideas'?{kind:'document',path:BOARD_PATH,content:JSON.stringify(draft)}:{kind:'none'},prompt:kind==='capture'?capturePrompt:ideasPrompt(question),...(kind==='capture'?{image:inputCapture.image}:{})}));
    }catch(e){request.current=null;setWorking('');setError(e.message);}
  };
  const persist=async(next,message)=>{
    if(saveLock.current||locked)return false;
    saveLock.current=true;setSaving(true);setError('');
    try{const content=writeBoard(next,document?.content);await onSave(content,document?.revision??null);if(!alive.current)return false;setUndo({board,after:content});setNotice(message);return true;}
    catch(e){if(alive.current)setError(e.message);return false;}
    finally{saveLock.current=false;if(alive.current)setSaving(false);}
  };
  const register=async()=>{
    try{const result=registerItems(board,review.filter(r=>selected.includes(r.id)));if(await persist(result.board,`${result.board.items.length-board.items.length}개 등록 · 중복 ${result.skipped}개 제외`)){setReview(null);setCapture(null);}}
    catch(e){setError(e.message);}
  };
  const openItem=item=>{if(working||saving)return;if(draft&&JSON.stringify(draft)!==draftOrigin.current){setError('변경한 내용을 저장하거나 닫은 뒤 다른 일정을 열어 주세요.');return;}setDraft(structuredClone(item));draftOrigin.current=JSON.stringify(item);setIdeas([]);setCapture(null);setReview(null);setError('');setTaskText('');};
  const saveItem=async()=>{
    try{const item=normalizeItem(draft),current=board.items.find(i=>i.id===item.id);
      if(current&&JSON.stringify(current)!==draftOrigin.current)throw new Error('이 일정이 변경되었습니다. 상세 화면을 다시 열어 주세요.');
      const next={version:1,items:current?board.items.map(i=>i.id===item.id?item:i):registerItems(board,[item]).board.items};
      if(await persist(next,'일정과 준비 내용을 저장했습니다.')){setDraft(null);setIdeas([]);}
    }catch(e){setError(e.message);}
  };
  const adopt=(option,status)=>{
    setDraft(old=>({...old,decisions:[...old.decisions,{...option,question,status}],tasks:status==='adopted'?[...old.tasks,...option.tasks.map(text=>({id:crypto.randomUUID(),text,origin:'suggested',done:false}))]:old.tasks}));
    setIdeas(old=>old.filter(i=>i.id!==option.id));
  };
  const items=board.items.filter(i=>filter==='전체'||i.target===filter);
  const pending=items.filter(i=>i.status!=='done');
  const upcoming=pending.filter(i=>(i.end||i.start)&&dayNumber(i.end||i.start)-dayNumber(today)<=14);
  const currentReview=review?.[reviewIndex];
  const closeInspector=()=>{if(working)return;setDraft(null);setIdeas([]);};
  const renderCard=item=><button key={item.id} className={`planner-card ${tone(item.target)} ${item.status==='done'?'is-done':''}`} onClick={()=>openItem(item)} disabled={!!working}>
    <div className="planner-card-top"><span className="planner-tag">{item.target||'대상 미지정'}</span><span>{item.stage||'단계 미지정'}</span><ArrowUpRight size={16}/></div>
    <h3>{item.title}</h3><p><CalendarDays size={14}/>{dates(item)}</p>
    <div className="planner-card-bottom"><span className={`planner-status ${item.status}`}>{statuses[item.status]}</span><span><CheckCheck size={14}/>{item.tasks.filter(t=>t.done).length}/{item.tasks.length} 준비</span></div>
    {item.uncertainty&&<small><CircleHelp size={13}/>{item.uncertainty}</small>}
  </button>;

  return <section className="planner" aria-label="개발 플래너" onPaste={e=>{const files=[...e.clipboardData.files];if(files.length){e.preventDefault();loadImage(files[0]);}}} onDragOver={e=>{if([...e.dataTransfer.types].includes('Files'))e.preventDefault();}} onDrop={e=>{if(e.dataTransfer.files.length){e.preventDefault();loadImage(e.dataTransfer.files[0]);}}}>
    <datalist id="planner-targets">{[...new Set(['Link','BMS','PACK',...targets])].map(x=><option key={x}>{x}</option>)}</datalist><datalist id="planner-stages">{['CV','DV','PD','PV'].map(x=><option key={x}>{x}</option>)}</datalist>
    <input ref={fileInput} className="planner-file-input" type="file" accept="image/png,image/jpeg,image/webp" aria-label="일정 캡처 파일" onChange={e=>{loadImage(e.target.files[0]);e.target.value='';}}/>
    <header className="planner-header"><div className="planner-brand"><span><Flag size={20}/></span><div><strong>Development studio</strong><small>생각에서 다음 단계까지</small></div></div><nav aria-label="플래너 보기">{[['today','오늘',LayoutDashboard],['timeline','일정',CalendarDays],['evidence','근거',Link2]].map(([key,label,Icon])=><button key={key} aria-pressed={view===key} className={view===key?'selected':''} onClick={()=>setView(key)}><Icon size={15}/>{label}</button>)}</nav><button className="planner-button primary" disabled={locked||!!working} onClick={()=>openItem(normalizeItem({title:'새 일정'}))}><Plus size={16}/> 일정 추가</button></header>
    {(error||parsed.error)&&<div className="planner-alert" role="alert">{error||parsed.error}<button aria-label="플래너 오류 닫기" onClick={()=>setError('')}><X size={15}/></button></div>}
    {notice&&<div className="planner-notice" role="status"><Check size={15}/>{notice}{undo&&<button disabled={locked} onClick={async()=>{if(document?.content!==undo.after){setError('저장 후 문서가 변경되어 되돌릴 수 없습니다.');return;}if(await persist(undo.board,'이전 상태로 되돌렸습니다.'))setUndo(null);}}><Undo2 size={14}/> 실행 취소</button>}<button aria-label="플래너 안내 닫기" onClick={()=>setNotice('')}><X size={14}/></button></div>}
    <div className={`planner-layout ${draft?'with-inspector':''}`}>
      <div className="planner-main">
        <div className="planner-heading"><div><span className="planner-eyebrow">YOUR NEXT STEP · {today.replaceAll('-','. ')}</span><h1>{view==='today'?'복잡한 일정, 선명한 다음 행동.':view==='timeline'?'흩어진 일정을 하나의 흐름으로.':'결정에는 근거가 필요하니까.'}</h1><p>{view==='evidence'?'요구사항부터 시험 결과까지, 연결과 변경을 확인하세요.':'캡처 한 장으로 시작하고, 준비할 일을 차근차근 정리하세요.'}</p></div></div>
        {!draft&&<button className={`planner-capture ${capture?'has-image':''}`} disabled={!!working||locked} onClick={()=>fileInput.current.click()}><div className="planner-capture-icon"><ClipboardPaste size={25}/></div><div><strong>{capture?'다른 캡처로 바꾸기':'일정 캡처를 붙여넣으세요'}</strong><span>붙여넣기 · 끌어놓기 · 연결된 Copilot으로 자동 인식</span></div><kbd>⌘ / Ctrl V</kbd><ArrowRight size={19}/></button>}
        {capture&&!draft&&<section className="planner-capture-review" aria-label="캡처 검토">
          <SourceImage source={currentReview?.source??capture.source} vaultId={vaultId}/>
          <div className="planner-review-panel"><div className="planner-section-title"><h2>{review?'추출 결과 확인':'캡처를 일정으로'}</h2><button aria-label="캡처 닫기" disabled={!!working} onClick={()=>{setCapture(null);setReview(null);}}><X size={18}/></button></div>
            <p className="planner-help">연결된 Copilot 모델로 이 이미지를 분석합니다. 원본은 보관함에 보관되며, 등록 전 수정할 수 있습니다.</p>
            <div className="planner-ai-controls"><select aria-label="플래너 AI 모델" value={model} onChange={e=>setModel(e.target.value)}><option value="">모델 선택</option>{(auth?.models??[]).filter(m=>m.vision).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select><button onClick={connectStatus} disabled={!!working}>연결 확인</button>{!auth?.authenticated&&<button onClick={()=>invoke(api.copilotLogin()).then(()=>setNotice('브라우저에서 로그인 후 연결 확인을 눌러 주세요.')).catch(e=>setError(e.message))}>GitHub 연결</button>}</div>
            <button className="planner-button primary" disabled={!!working||!model||!auth?.models?.find(m=>m.id===model)?.vision} onClick={()=>runAI('capture')}>{working==='capture'?<LoaderCircle className="planner-spin" size={16}/>:<Sparkles size={16}/>} {review?'다시 분석':'일정 인식하기'}</button>
            {working==='capture'&&<button className="planner-button" onClick={()=>api.copilotCancel({requestId:request.current?.id})}>분석 취소</button>}
            {review&&<><div className="planner-review-tabs">{review.map((r,i)=><div key={r.id}><input type="checkbox" aria-label={`${r.title} 등록 선택`} checked={selected.includes(r.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,r.id]:old.filter(id=>id!==r.id))}/><button className={reviewIndex===i?'selected':''} onClick={()=>setReviewIndex(i)}>{r.title}</button></div>)}</div>
              {currentReview&&<><ItemFields prefix="추출 " item={currentReview} onChange={next=>setReview(old=>old.map((r,i)=>i===reviewIndex?next:r))}/><p className="planner-help">{currentReview.tasks.length}개 명시된 준비 작업 · 날짜 미정 항목도 그대로 등록할 수 있습니다.</p></>}
              <button className="planner-button primary full" disabled={!selected.length||locked||!!working} onClick={register}><Check size={16}/>선택한 {selected.length}개 등록</button></>}
          </div>
        </section>}
        {working==='import'&&<p role="status"><LoaderCircle className="planner-spin" size={16}/> 캡처를 보관하는 중…</p>}
        <div className="planner-filters"><button className={filter==='전체'?'selected':''} onClick={()=>setFilter('전체')}>전체 <span>{board.items.length}</span></button>{targets.map(t=><button key={t} className={filter===t?'selected':''} onClick={()=>setFilter(t)}>{t}</button>)}<button className="planner-open-note" onClick={()=>onOpen(BOARD_PATH)} disabled={!document}><Link2 size={13}/> 원본 노트</button></div>
        {view==='today'&&<><div className="planner-stats"><div><span>다가오는 2주 · 지연 포함</span><strong>{upcoming.length}<small>개의 일정</small></strong></div><div><span>남은 준비</span><strong>{pending.reduce((n,i)=>n+i.tasks.filter(t=>!t.done).length,0)}<small>개의 행동</small></strong></div><div><span>확인이 필요한 일정</span><strong>{pending.filter(i=>i.uncertainty||(!i.start&&!i.end)||i.status==='blocked').length}<small>개의 확인</small></strong></div></div><div className="planner-section-title"><h2>다음에 준비할 것</h2><span>일정을 눌러 준비와 근거를 연결하세요</span></div><div className="planner-cards">{[...items].sort((a,b)=>Number(a.status==='done')-Number(b.status==='done')||(a.end||a.start||'9999').localeCompare(b.end||b.start||'9999')).map(renderCard)}</div></>}
        {view==='timeline'&&<Timeline items={items} today={today} onOpen={openItem} locked={locked||!!working} onMove={async(item,start)=>{try{const moved=reschedule(item,start);await persist({version:1,items:board.items.map(i=>i.id===moved.id?moved:i)},'일정을 이동했습니다.');}catch(e){setError(e.message);}}}/>}
        {view==='evidence'&&<div className="planner-evidence-board">{items.map(item=>{const issues=evidenceIssues(item,notes);return <button key={item.id} onClick={()=>openItem(item)} className="planner-evidence-row"><div><span className="planner-tag">{item.target||'대상 미지정'}</span><h3>{item.title}</h3></div><div className="planner-evidence-chain">{Object.entries(EVIDENCE_KINDS).map(([k,v])=><span key={k} className={item.evidence.some(e=>e.kind===k)?'linked':''}>{v}</span>)}</div><small>{issues.length?`${issues.length}개 확인 필요`:'연결 확인됨 · 내용 검토는 별도'}</small><ArrowRight size={16}/></button>;})}</div>}
        {!items.length&&!capture&&<div className="planner-empty"><Flag size={30}/><h2>첫 번째 일정을 담아보세요.</h2><p>캡처를 붙이거나 일정을 직접 추가하면<br/>준비할 일과 결정의 근거가 이곳에 모입니다.</p></div>}
      </div>
      {draft&&<aside className="planner-inspector" aria-label="일정 상세"><div className="planner-inspector-heading"><span><Flag size={15}/> 일정과 다음 행동</span><button aria-label="일정 상세 닫기" onClick={closeInspector} disabled={!!working||saving}><X size={18}/></button></div><fieldset disabled={saving||!!working} className="planner-inspector-scroll">
        <ItemFields item={draft} onChange={setDraft}/><label className="planner-label">메모<textarea aria-label="일정 메모" value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})} placeholder="기억해야 할 배경과 결정…"/></label>
        <section><div className="planner-section-title"><h2>준비할 일</h2><span>{draft.tasks.filter(t=>t.done).length}/{draft.tasks.length}</span></div>{draft.tasks.map(t=><label className="planner-task" key={t.id}><input type="checkbox" checked={t.done} onChange={e=>setDraft({...draft,tasks:draft.tasks.map(x=>x.id===t.id?{...x,done:e.target.checked}:x)})}/><span>{t.text}<small>{t.origin==='suggested'?'AI 제안 채택':'직접 기록 · 원본'}</small></span><button aria-label={`${t.text} 준비 삭제`} onClick={()=>setDraft({...draft,tasks:draft.tasks.filter(x=>x.id!==t.id)})}><X size={13}/></button></label>)}<form className="planner-inline" onSubmit={e=>{e.preventDefault();if(taskText.trim()){setDraft({...draft,tasks:[...draft.tasks,{id:crypto.randomUUID(),text:taskText.trim(),done:false,origin:'source'}]});setTaskText('');}}}><input aria-label="새 준비 작업" placeholder="준비할 일 추가" value={taskText} maxLength={500} onChange={e=>setTaskText(e.target.value)}/><button aria-label="준비 작업 추가"><Plus size={18}/></button></form></section>
        <section className="planner-brainstorm"><div className="planner-section-title"><h2><Sparkles size={17}/> 함께 생각하기</h2><span>AI 제안</span></div><textarea aria-label="Brainstorming 질문" value={question} maxLength={2000} onChange={e=>setQuestion(e.target.value)}/><div className="planner-ai-controls"><select aria-label="Brainstorming 모델" value={model} onChange={e=>setModel(e.target.value)}><option value="">모델 선택</option>{(auth?.models??[]).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select><button onClick={connectStatus} disabled={!!working}>연결 확인</button>{!auth?.authenticated&&<button onClick={()=>invoke(api.copilotLogin()).then(()=>setNotice('브라우저에서 로그인 후 연결 확인을 눌러 주세요.')).catch(e=>setError(e.message))}>GitHub 연결</button>}</div><p className="planner-help">질문과 이 일정의 내용만 AI에 전송합니다.</p><button className="planner-button" disabled={!!working||!model} onClick={()=>runAI('ideas')}>{working==='ideas'?<LoaderCircle className="planner-spin" size={15}/>:<Sparkles size={15}/>} 대안 살펴보기</button>{working==='ideas'&&<button onClick={()=>api.copilotCancel({requestId:request.current?.id})}>취소</button>}
          {ideas.map(i=><article className="planner-idea" key={i.id}><h3>{i.title}</h3><p>{i.reason}</p><small>고려할 점 · {i.tradeoff}</small><ul>{i.tasks.map((t,n)=><li key={n}>{t}</li>)}</ul><div><button onClick={()=>adopt(i,'deferred')}>보류</button><button onClick={()=>adopt(i,'adopted')}><Check size={14}/> 채택 · 준비에 추가</button></div></article>)}
          {draft.decisions.map(d=><div className="planner-decision" key={d.id}><span>{d.status==='adopted'?'채택':'보류'}</span><strong>{d.title}</strong><p>{d.reason}</p></div>)}
        </section>
        <section><div className="planner-section-title"><h2>V모델 근거 연결</h2><span>문서 ≠ 시험 통과</span></div><div className="planner-evidence-add"><select aria-label="근거 종류" value={evidenceKind} onChange={e=>setEvidenceKind(e.target.value)}>{Object.entries(EVIDENCE_KINDS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><select aria-label="근거 문서" value={evidencePath} onChange={e=>setEvidencePath(e.target.value)}><option value="">문서 선택</option>{notes.filter(n=>n.path!==BOARD_PATH).map(n=><option key={n.path}>{n.path}</option>)}</select><button aria-label="근거 연결" disabled={!evidencePath} onClick={()=>{const n=notes.find(n=>n.path===evidencePath);if(!n)return;if(!draft.evidence.some(e=>e.path===n.path&&e.kind===evidenceKind))setDraft({...draft,evidence:[...draft.evidence,{kind:evidenceKind,path:n.path,revision:n.revision,status:'unknown'}]});setEvidencePath('');}}><Plus size={18}/></button></div>
          {draft.evidence.map((e,i)=><div className="planner-evidence-link" key={`${e.kind}:${e.path}`}><span>{EVIDENCE_KINDS[e.kind]}</span><button onClick={()=>{if(JSON.stringify(draft)!==draftOrigin.current){setError('변경한 내용을 저장한 뒤 근거 문서를 열어 주세요.');return;}onOpen(e.path);}}>{e.path}</button>{e.kind==='result'&&<select aria-label={`${e.path} 시험 결과`} value={e.status} onChange={event=>setDraft({...draft,evidence:draft.evidence.map((x,n)=>n===i?{...x,status:event.target.value}:x)})}><option value="unknown">미확인</option><option value="pass">통과</option><option value="fail">실패</option></select>}<button title="현재 문서를 검토한 버전으로 기록" aria-label={`${e.path} 재검토 확인`} onClick={()=>{const n=notes.find(n=>n.path===e.path);if(n)setDraft({...draft,evidence:draft.evidence.map((x,j)=>i===j?{...x,revision:n.revision}:x)});}}><Check size={14}/></button><button aria-label={`${e.path} 연결 해제`} onClick={()=>setDraft({...draft,evidence:draft.evidence.filter((_,j)=>i!==j)})}><X size={13}/></button></div>)}
          <div className="planner-evidence-issues">{evidenceIssues(draft,notes).map((issue,i)=><p key={i}><CircleHelp size={12}/>{issue}</p>)}</div>
        </section><SourceImage source={draft.source} vaultId={vaultId}/>
      </fieldset><footer>{working&&<button className="planner-button" onClick={()=>api.copilotCancel({requestId:request.current?.id})}>AI 취소</button>}<button className="planner-button" onClick={closeInspector} disabled={!!working||saving}>닫기 · 변경 취소</button><button className="planner-button primary" disabled={locked||!!working} onClick={saveItem}>{saving?<LoaderCircle className="planner-spin" size={15}/>:<Check size={15}/>} 저장</button></footer></aside>}
    </div>
  </section>;
}

function Timeline({items,today,onOpen,onMove,locked}) {
  const dated=items.filter(i=>validDate(i.start||i.end)), starts=dated.map(i=>dayNumber(i.start||i.end));
  const first=Math.min(dayNumber(today),...starts), last=Math.max(first+27,...dated.map(i=>dayNumber(i.end||i.start)));
  const [offset,setOffset]=useState(0),drag=useRef(null);
  const begin=first+offset, days=28,cell=34;
  const dateFor=n=>new Date(n*86400000).toISOString().slice(0,10);
  return <div className="planner-timeline"><div className="planner-section-title"><h2>4주 타임라인</h2><div><button aria-label="이전 4주" onClick={()=>setOffset(o=>o-28)}><ChevronLeft size={17}/></button><button onClick={()=>setOffset(0)}>처음</button><button aria-label="다음 4주" onClick={()=>setOffset(o=>o+28)}><ArrowRight size={17}/></button></div></div><p className="planner-help">일정 막대를 끌면 기간을 유지하며 이동합니다. 클릭하면 날짜를 직접 수정할 수 있습니다.</p><div className="planner-timeline-scroll"><div style={{minWidth:190+cell*days}}><div className="planner-timeline-head"><span>{dateFor(begin).slice(0,7)}</span>{Array.from({length:days},(_,n)=><span key={n} className={dateFor(begin+n)===today?'today':''}>{dateFor(begin+n).slice(5)}</span>)}</div>{dated.map(item=>{const start=dayNumber(item.start||item.end),end=dayNumber(item.end||item.start),visible=end>=begin&&start<begin+days;return <div className="planner-timeline-row" key={item.id}><button className="planner-timeline-name" onClick={()=>onOpen(item)}><span>{item.target||'미지정'}</span>{item.title}</button><div className="planner-track" style={{width:cell*days}}>{visible&&<button className={`planner-bar ${tone(item.target)}`} aria-label={`${item.title} 일정 이동`} disabled={locked} title={`${dates(item)} · 끌어서 이동`} style={{left:Math.max(0,start-begin)*cell,width:Math.max(24,(Math.min(end,begin+days-1)-Math.max(start,begin)+1)*cell-4)}} onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,item};}} onPointerUp={e=>{const d=drag.current;drag.current=null;if(!d)return;const delta=Math.round((e.clientX-d.x)/cell);if(delta)onMove(item,dateFor(start+delta));else onOpen(item);}} onPointerCancel={()=>{drag.current=null;}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onOpen(item);}}}>{item.stage||item.title}</button>}</div></div>;})}</div></div><p className="planner-help">날짜 미정 {items.length-dated.length}개 · 전체 범위 {dateFor(first)} — {dateFor(last)}</p></div>;
}
