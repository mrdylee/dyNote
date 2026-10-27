import {useState} from 'react';
import {diagramSamples} from '../core/diagram-tools.mjs';
export default function MermaidTools({onInsert, disabled}) {
  const [family,setFamily]=useState(diagramSamples[0].id);
  const [code,setCode]=useState(diagramSamples[0].code);
  return <section className="mermaid-tools">
    <label>도표 종류<select aria-label="Mermaid 도표 종류" value={family} onChange={e=>{setFamily(e.target.value);setCode(diagramSamples.find(s=>s.id===e.target.value).code);}}>{diagramSamples.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
    <label>Mermaid 코드<textarea aria-label="Mermaid 코드" rows={12} value={code} onChange={e=>setCode(e.target.value)}/></label>
    <p className="muted">커서나 선택 영역에 삽입합니다. Mermaid 코드 블록 안에서는 코드만 넣습니다.</p>
    <button className="primary-button" disabled={disabled || !code.trim()} onClick={()=>onInsert(code)}>도표 삽입</button>
  </section>;
}
