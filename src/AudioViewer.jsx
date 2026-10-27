import {useEffect,useState} from 'react';
export default function AudioViewer({bytes,mime}) {
  const [url,setUrl]=useState(null);
  useEffect(()=>{const value=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:mime}));setUrl(value);return()=>URL.revokeObjectURL(value);},[bytes,mime]);
  return url?<audio controls src={url} aria-label="오디오 재생"/>:<p>오디오 불러오는 중…</p>;
}
