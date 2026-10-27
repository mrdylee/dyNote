import {useEffect,useRef,useState} from 'react';
export default function AudioRecorder({onSave,onCancel,onActive}) {
  const [phase,setPhase]=useState('idle'),[seconds,setSeconds]=useState(0),[error,setError]=useState('');
  const stream=useRef(null),recorder=useRef(null),chunks=useRef([]),size=useRef(0),disposed=useRef(false),cancelled=useRef(false),started=useRef(0),generation=useRef(0);
  const stopTracks=()=>{stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;};
  useEffect(()=>()=>{disposed.current=true;cancelled.current=true;generation.current++;if(recorder.current?.state==='recording')recorder.current.stop();stopTracks();onActive(false);},[]);
  useEffect(()=>{if(phase!=='recording')return;const timer=setInterval(()=>setSeconds(Math.floor((Date.now()-started.current)/1000)),1000);return()=>clearInterval(timer);},[phase]);
  const save=async()=>{
    setPhase('saving');setError('');
    try{
      const blob=new Blob(chunks.current,{type:'audio/webm'});
      if(!blob.size)throw new Error('저장할 녹음 데이터가 없습니다.');
      await onSave({name:`Recording-${new Date().toISOString().replace(/[:.]/g,'-')}.webm`,bytes:new Uint8Array(await blob.arrayBuffer())});
      if(!disposed.current){onActive(false);setPhase('idle');}
    }catch(e){if(!disposed.current){setError(e.message);setPhase('retry');}}
  };
  const start=async()=>{
    const run=++generation.current;
    setError('');setPhase('requesting');setSeconds(0);onActive(true);cancelled.current=false;chunks.current=[];size.current=0;
    try{
      const value=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
      if(disposed.current||cancelled.current||run!==generation.current){value.getTracks().forEach(track=>track.stop());return;}
      stream.current=value;
      const job=new MediaRecorder(value,{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:128000});recorder.current=job;
      job.ondataavailable=event=>{if(disposed.current||cancelled.current||run!==generation.current)return;if(event.data.size){chunks.current.push(event.data);size.current+=event.data.size;if(size.current>=24*1024*1024&&job.state==='recording')job.stop();}};
      job.onstop=()=>{if(run!==generation.current)return;stopTracks();if(!disposed.current&&!cancelled.current)save();};
      job.onerror=()=>{if(run!==generation.current)return;cancelled.current=true;stopTracks();if(!disposed.current){setError('녹음을 계속할 수 없습니다. 마이크 상태를 확인해 주세요.');setPhase('idle');onActive(false);}};
      job.start(1000);started.current=Date.now();setPhase('recording');
    }catch(e){stopTracks();if(!disposed.current){setPhase('idle');onActive(false);setError(e.name==='NotAllowedError'?'마이크 사용을 허용해 주세요.':e.message);}}
  };
  const cancel=()=>{cancelled.current=true;generation.current++;if(recorder.current?.state==='recording')recorder.current.stop();stopTracks();onActive(false);onCancel();};
  return <section className="audio-recorder" aria-label="음성 녹음">
    <p>시작 버튼을 누르면 마이크 권한을 요청합니다. 녹음은 보관함의 오디오 파일로 저장됩니다.</p>
    <p role="status">{phase==='recording'?`녹음 중 · ${seconds}초`:phase==='requesting'?'마이크 연결 중…':phase==='saving'?'녹음 저장 중…':phase==='retry'?'저장하지 못한 녹음이 남아 있습니다.':'녹음 준비됨'}</p>
    {error&&<p role="alert">{error}</p>}
    <div className="audio-actions">
      {phase==='idle'&&<button className="primary-button" onClick={start}>녹음 시작</button>}
      {phase==='recording'&&<button className="primary-button" onClick={()=>{if(recorder.current?.state==='recording'){setPhase('saving');recorder.current.stop();}}}>녹음 중단하고 저장</button>}
      {phase==='retry'&&<button className="primary-button" onClick={save}>녹음 저장 다시 시도</button>}
      <button disabled={phase==='saving'} onClick={cancel}>녹음 취소</button>
    </div>
    <p className="muted">저장한 파일에는 현재 보관함의 Git 백업 설정이 적용됩니다. 취소하면 저장하지 않은 녹음만 지웁니다.</p>
  </section>;
}
