import {mkdir,readFile,writeFile,rename,rm,open} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {checkReleaseInformation,releaseInformation} from './update-information.mjs';
const WEEK=7*86400000,HOUR=3600000,MAX_SIZE=2*1024*1024*1024;
function preferences(value={}) {
  return {enabled:value.enabled!==false,backgroundDownload:value.backgroundDownload!==false,includePrerelease:value.includePrerelease===true,ignored:Array.isArray(value.ignored)?value.ignored.filter(x=>typeof x==='string').slice(-100):[]};
}
export class UpdateManager {
  constructor({directory,current,platform=process.platform,arch=process.arch,now=Date.now,fetcher=(...args)=>fetch(...args),check,onChange=()=>{}}) {
    Object.assign(this,{directory,current,platform,arch,now,fetcher,onChange});
    this.lookup=check??(()=>checkReleaseInformation(current,this.state.preferences.includePrerelease,{platform,arch}));
    this.state={preferences:preferences(),lastCheckedAt:0,lastAttemptAt:0,retryAt:0,phase:'idle',result:null,message:'',progress:0};
    this.pending=null;this.cached=null;
  }
  emit(change){Object.assign(this.state,change);this.onChange(structuredClone(this.state));}
  async persist(){
    const file=path.join(this.directory,'settings.json');
    await writeFile(file+'.tmp',JSON.stringify({...this.state,cached:this.cached}));await rename(file+'.tmp',file);
  }
  async init(){
    await mkdir(this.directory,{recursive:true});
    let saved;try{saved=JSON.parse(await readFile(path.join(this.directory,'settings.json'),'utf8'));}catch{}
    if(saved){
      this.state.preferences=preferences(saved.preferences);
      for(const key of ['lastCheckedAt','lastAttemptAt','retryAt'])this.state[key]=Number.isFinite(saved[key])?saved[key]:0;
      if(saved.cached){
        const c=saved.cached;
        const result=releaseInformation([{tag_name:c.tag,assets:[{name:c.asset?.name,browser_download_url:c.asset?.url,size:c.asset?.size,digest:c.asset?.digest}]}],this.current,this.state.preferences.includePrerelease,{platform:this.platform,arch:this.arch});
        if(result.available){
          this.cached={tag:result.latest.tag,asset:result.latest.assets[0]};
          try{await this.verify(this.cached.asset);this.emit({phase:'ready',result,message:'다운로드 검증 완료 · 직접 설치할 수 있습니다.'});}catch{this.cached=null;this.state.lastCheckedAt=0;}
        }
      }
    }
    return this.state;
  }
  async configure(change){
    if(this.pending)throw new Error('업데이트 확인 또는 다운로드가 끝난 후 설정을 변경해 주세요.');
    this.pending=(async()=>{
      const before=structuredClone(this.state),cached=this.cached;
      this.state.preferences=preferences({...before.preferences,...change});
      if(before.preferences.includePrerelease!==this.state.preferences.includePrerelease){this.cached=null;Object.assign(this.state,{result:null,phase:'idle',lastCheckedAt:0,retryAt:0,message:''});}
      try{await this.persist();this.emit({});return this.state;}catch(error){this.state=before;this.cached=cached;this.emit({});throw error;}
    })().finally(()=>{this.pending=null;});
    return this.pending;
  }
  check(manual=false){
    if(this.pending)return this.pending;
    const {preferences,lastCheckedAt,retryAt}=this.state,now=this.now();
    if(!manual&&(!preferences.enabled||(retryAt>now&&retryAt-now<=HOUR)||(!retryAt&&lastCheckedAt&&now>=lastCheckedAt&&now-lastCheckedAt<WEEK)))return Promise.resolve(this.state);
    this.pending=this.runCheck().finally(()=>{this.pending=null;});return this.pending;
  }
  async runCheck(){
    this.emit({phase:'checking',lastAttemptAt:this.now(),result:null,message:''});
    try{
      const result=await this.lookup();
      this.emit({result,lastCheckedAt:this.now(),retryAt:0,phase:result.available?'available':'idle',message:''});
      if(result.available&&!this.state.preferences.ignored.includes(result.latest.tag)&&this.state.preferences.backgroundDownload)await this.downloadAsset();
      await this.persist();
    }catch(error){this.emit({phase:'error',message:error.message,retryAt:this.now()+HOUR});await this.persist();}
    return this.state;
  }
  cachePath(asset){
    if(!asset?.digest||!/^sha256:[a-f0-9]{64}$/.test(asset.digest)||!/^Dynote-[a-z0-9._-]{1,150}\.zip$/i.test(asset.name))throw new Error('공식 배포 파일의 검증 정보가 없습니다. 릴리스 페이지에서 다운로드해 주세요.');
    return path.join(this.directory,asset.digest.slice(7)+'-'+asset.name);
  }
  async verify(asset){
    const file=this.cachePath(asset),hash=createHash('sha256');let size=0;
    for await(const chunk of createReadStream(file)){size+=chunk.length;if(size>MAX_SIZE)throw new Error('배포 파일 크기가 너무 큽니다.');hash.update(chunk);}
    if(size!==asset.size||'sha256:'+hash.digest('hex')!==asset.digest)throw new Error('다운로드 파일 검증에 실패했습니다. 다시 다운로드해 주세요.');
    return file;
  }
  download(){
    if(this.pending)return this.pending;
    this.pending=(async()=>{try{await this.downloadAsset();await this.persist();}catch(error){this.emit({phase:'error',message:error.message,retryAt:this.now()+HOUR});await this.persist();}return this.state;})().finally(()=>{this.pending=null;});
    return this.pending;
  }
  async downloadAsset(){
    const result=this.state.result,asset=result?.latest?.assets[0];
    if(!result?.available||!asset)throw new Error('다운로드할 새 배포 파일이 없습니다.');
    if(!asset.digest||!asset.size||asset.size>MAX_SIZE){this.emit({phase:'available',message:'공식 배포의 검증 정보가 없거나 크기가 지원 범위를 넘습니다. 릴리스 페이지에서 직접 다운로드해 주세요.'});return;}
    const file=this.cachePath(asset),partial=file+'.part';
    try{await this.verify(asset);this.cached={tag:result.latest.tag,asset};this.emit({phase:'ready',progress:100,message:'다운로드 검증 완료 · 직접 설치할 수 있습니다.'});return;}catch{}
    this.cached=null;this.emit({phase:'downloading',progress:0,message:'백그라운드에서 다운로드 중입니다.'});
    let handle;
    try{
      const url=new URL(asset.url);
      if(url.origin!=='https://github.com'||!url.pathname.startsWith('/mrdylee/dyNote/releases/download/'))throw new Error('공식 배포 경로가 아닙니다.');
      const response=await this.fetcher(url.href,{signal:AbortSignal.timeout(30*60*1000)});
      if(!response.ok||!response.body)throw new Error(`다운로드 실패 (${response.status})`);
      await rm(partial,{force:true});handle=await open(partial,'wx');
      let size=0,progress=-1;const hash=createHash('sha256');
      for await(const chunk of response.body){
        size+=chunk.length;if(size>asset.size||size>MAX_SIZE)throw new Error('배포 파일 크기가 예상과 다릅니다.');
        hash.update(chunk);await handle.writeFile(chunk);
        const next=Math.floor(size/asset.size*100);if(next!==progress){progress=next;this.emit({progress});}
      }
      if(size!==asset.size||'sha256:'+hash.digest('hex')!==asset.digest)throw new Error('다운로드 파일 검증에 실패했습니다. 다시 다운로드해 주세요.');
      await handle.close();handle=null;await rename(partial,file);
      this.cached={tag:result.latest.tag,asset};this.emit({phase:'ready',progress:100,retryAt:0,message:'다운로드 검증 완료 · 직접 설치할 수 있습니다.'});
    }finally{await handle?.close();await rm(partial,{force:true});}
  }
  async readyPath(){if(!this.cached||this.state.phase!=='ready')throw new Error('검증 완료된 다운로드가 없습니다.');return this.verify(this.cached.asset);}
}
