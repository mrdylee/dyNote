import {mkdir,readFile,writeFile,rename,rm,open,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {allowedUpdateAsset,validateInternalFeedUrl,checkReleaseInformation,matchesUpdateAsset,releaseInformation} from './update-information.mjs';
const WEEK=7*86400000,HOUR=3600000,MAX_SIZE=2*1024*1024*1024;
function preferences(value={},downloadDirectory) {
  return {source:value.source === 'internal' ? 'internal' : 'github',
    internalFeedUrl:typeof value.internalFeedUrl === 'string' ? value.internalFeedUrl : '',
    enabled:value.enabled!==false,backgroundDownload:value.backgroundDownload!==false,autoInstall:value.autoInstall!==false,includePrerelease:value.includePrerelease===true,ignored:Array.isArray(value.ignored)?value.ignored.filter(x=>typeof x==='string').slice(-100):[],downloadDirectory:typeof value.downloadDirectory==='string'&&path.isAbsolute(value.downloadDirectory)&&!value.downloadDirectory.includes('\0')?value.downloadDirectory:downloadDirectory};
}
export class UpdateManager {
  constructor({directory,downloadDirectory=directory,current,platform=process.platform,arch=process.arch,installed=false,now=Date.now,fetcher=(...args)=>fetch(...args),check,onChange=()=>{}}) {
    Object.assign(this,{directory,current,now,fetcher,onChange});
    this.target = {platform, arch, installed};
    this.lookup=check??(()=>checkReleaseInformation(current,this.state.preferences.includePrerelease,this.target,this.internalFeedUrl,this.fetcher));
    this.defaultDownloadDirectory=downloadDirectory;
    this.state={preferences:preferences({},downloadDirectory),installSupported:platform==='win32'&&arch==='x64'&&installed,installation:null,lastCheckedAt:0,lastAttemptAt:0,retryAt:0,phase:'idle',result:null,message:'',progress:0,downloadedPath:null};
    this.pending=null;this.cached=null;
  }
  get internalFeedUrl() {
    return this.state.preferences.source === 'internal' ? this.state.preferences.internalFeedUrl : null;
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
      this.state.preferences=preferences(saved.preferences,this.defaultDownloadDirectory);
      this.state.installation=saved.installation??null;
      for(const key of ['lastCheckedAt','lastAttemptAt','retryAt'])this.state[key]=Number.isFinite(saved[key])?saved[key]:0;
      if(saved.cached){
        const c=saved.cached;
        const result=releaseInformation([{tag_name:c.tag,assets:[{name:c.asset?.name,browser_download_url:c.asset?.url,size:c.asset?.size,digest:c.asset?.digest}]}],this.current,this.state.preferences.includePrerelease,this.target,this.internalFeedUrl);
        if(result.available){
          this.cached={tag:result.latest.tag,asset:result.latest.assets[0],directory:typeof c.directory==='string'&&path.isAbsolute(c.directory)?c.directory:this.directory};
          try{const file=await this.verify(this.cached.asset,this.cached.directory);this.emit({phase:'ready',result,downloadedPath:file,message:'다운로드 검증 완료'});}catch{this.cached=null;this.state.lastCheckedAt=0;}
        } else if (c.asset?.name && !matchesUpdateAsset(c.asset.name, this.target)) {
          this.state.lastCheckedAt = 0;
          this.state.retryAt = 0;
        }
      }
      const attempt=this.state.installation;
      if(attempt&&typeof attempt.directory==='string'&&path.dirname(attempt.directory)===path.join(this.directory,'install')&&/^[a-f0-9-]{36}$/.test(path.basename(attempt.directory))){
        if(this.cached?.tag===attempt.tag){
          let result;try{result=JSON.parse((await readFile(path.join(attempt.directory,'result.json'),'utf8')).replace(/^\uFEFF/,''));}catch{}
          this.state.message=attempt.error||result?.error||'이전 업데이트 설치가 완료되지 않았습니다. 지금 설치를 눌러 다시 시도해 주세요.';
        }else if(!releaseInformation([{tag_name:attempt.tag}],this.current,true).available){
          await rm(attempt.directory,{recursive:true,force:true}).catch(()=>{});
          this.state.installation=null;
        }
      }else if(attempt?.error)this.state.message=attempt.error;
    }
    return this.state;
  }
  async configure(change){
    if(this.pending||this.state.phase==='installing')throw new Error('업데이트 확인 또는 설치가 끝난 후 설정을 변경해 주세요.');
    this.pending=(async()=>{
      const before=structuredClone(this.state),cached=this.cached;
      if(Object.hasOwn(change,'downloadDirectory')){
        const folder=change.downloadDirectory;
        if(typeof folder!=='string'||!path.isAbsolute(folder)||folder.includes('\0')||!(await stat(folder)).isDirectory())throw new Error('다운로드할 폴더를 선택해 주세요.');
      }
      if (Object.hasOwn(change,'source') && !['github','internal'].includes(change.source)) throw new Error('업데이트 배포처를 선택해 주세요.');
      const previousFeed = this.internalFeedUrl;
      const next = preferences({...before.preferences,...change},this.defaultDownloadDirectory);
      if (Object.hasOwn(change,'internalFeedUrl') && change.internalFeedUrl !== '') next.internalFeedUrl = validateInternalFeedUrl(change.internalFeedUrl);
      this.state.preferences=next;
      const sourceChanged = previousFeed !== this.internalFeedUrl;
      if (sourceChanged) {
        next.ignored = [];
        this.state.installation = null;
      }
      if (sourceChanged || before.preferences.includePrerelease !== next.includePrerelease) {
        this.cached = null;
        Object.assign(this.state, {result:null, phase:'idle', progress:0, lastCheckedAt:0, retryAt:0, message:'', downloadedPath:null});
      }
      try{await this.persist();this.emit({});return this.state;}catch(error){this.state=before;this.cached=cached;this.emit({});throw error;}
    })().finally(()=>{this.pending=null;});
    return this.pending;
  }
  check(manual=false){
    if(this.state.phase==='installing')return Promise.resolve(this.state);
    if(this.pending)return this.pending;
    const {preferences,lastCheckedAt,retryAt}=this.state,now=this.now();
    const interval = this.internalFeedUrl === null ? WEEK : 24 * HOUR;
    if(!manual&&(!preferences.enabled||this.internalFeedUrl === ''||(retryAt>now&&retryAt-now<=HOUR)||(!retryAt&&lastCheckedAt&&now>=lastCheckedAt&&now-lastCheckedAt<interval)))return Promise.resolve(this.state);
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
  cachePath(asset,directory=this.state.preferences.downloadDirectory){
    if(!asset?.digest||!/^sha256:[a-f0-9]{64}$/.test(asset.digest)||!matchesUpdateAsset(asset.name,this.target))throw new Error('공식 배포 파일의 검증 정보가 없습니다. 릴리스 페이지에서 다운로드해 주세요.');
    return path.join(directory,asset.digest.slice(7)+'-'+asset.name);
  }
  async verify(asset,directory=this.state.preferences.downloadDirectory){
    const file=this.cachePath(asset,directory),hash=createHash('sha256');let size=0;
    for await(const chunk of createReadStream(file)){size+=chunk.length;if(size>MAX_SIZE)throw new Error('배포 파일 크기가 너무 큽니다.');hash.update(chunk);}
    if(size!==asset.size||'sha256:'+hash.digest('hex')!==asset.digest)throw new Error('다운로드 파일 검증에 실패했습니다. 다시 다운로드해 주세요.');
    return file;
  }
  download(){
    if(this.state.phase==='installing')return Promise.resolve(this.state);
    if(this.pending)return this.pending;
    this.pending=(async()=>{try{await this.downloadAsset();await this.persist();}catch(error){this.emit({phase:'error',message:error.message,retryAt:this.now()+HOUR});await this.persist();}return this.state;})().finally(()=>{this.pending=null;});
    return this.pending;
  }
  async downloadAsset(){
    const result=this.state.result,asset=result?.latest?.assets[0];
    if(!result?.available||!asset)throw new Error('다운로드할 새 배포 파일이 없습니다.');
    if(!asset.digest||!asset.size||asset.size>MAX_SIZE){this.emit({phase:'available',message:'공식 배포의 검증 정보가 없거나 크기가 지원 범위를 넘습니다. 릴리스 페이지에서 직접 다운로드해 주세요.'});return;}
    const directory=this.state.preferences.downloadDirectory,file=this.cachePath(asset),partial=file+'.'+randomUUID()+'.part';
    await mkdir(directory,{recursive:true});
    try{await this.verify(asset);this.cached={tag:result.latest.tag,asset,directory};this.emit({phase:'ready',progress:100,downloadedPath:file,message:'다운로드 검증 완료'});return;}catch{}
    this.emit({phase:'downloading',progress:0,message:'백그라운드에서 다운로드 중입니다.'});
    let handle;
    try{
      const url=new URL(asset.url);
      if(!allowedUpdateAsset(url,asset.name,this.internalFeedUrl))throw new Error('공식 배포 경로가 아닙니다.');
      const response=await this.fetcher(url.href,{redirect:this.internalFeedUrl === null ? 'follow' : 'error',signal:AbortSignal.timeout(30*60*1000)});
      if(!response.ok||!response.body)throw new Error(`다운로드 실패 (${response.status})`);
      handle=await open(partial,'wx');
      let size=0,progress=-1;const hash=createHash('sha256');
      for await(const chunk of response.body){
        size+=chunk.length;if(size>asset.size||size>MAX_SIZE)throw new Error('배포 파일 크기가 예상과 다릅니다.');
        hash.update(chunk);await handle.writeFile(chunk);
        const next=Math.floor(size/asset.size*100);if(next!==progress){progress=next;this.emit({progress});}
      }
      if(size!==asset.size||'sha256:'+hash.digest('hex')!==asset.digest)throw new Error('다운로드 파일 검증에 실패했습니다. 다시 다운로드해 주세요.');
      await handle.close();handle=null;await rename(partial,file);
      this.cached={tag:result.latest.tag,asset,directory};this.emit({phase:'ready',progress:100,retryAt:0,downloadedPath:file,message:'다운로드 검증 완료'});
    }finally{await handle?.close();await rm(partial,{force:true});}
  }
  async readyPath(){if(!this.cached)throw new Error('검증 완료된 다운로드가 없습니다.');return this.verify(this.cached.asset,this.cached.directory);}
  async beginInstall(stage){
    if(!this.state.installSupported)throw new Error('자동 설치는 Windows 설치형 앱에서 지원합니다.');
    if(this.pending||this.state.phase!=='ready')throw new Error('업데이트 다운로드가 끝난 후 다시 시도해 주세요.');
    this.pending=(async()=>{
      const file=await this.readyPath();
      const job=await stage({file,asset:this.cached.asset,tag:this.cached.tag});
      this.emit({phase:'installing',installation:{tag:this.cached.tag,directory:job.directory},message:'작업을 저장한 뒤 업데이트하고 다시 시작합니다.'});
      try{await this.persist();}catch(error){this.emit({phase:'ready',message:error.message});throw error;}
      return job;
    })().finally(()=>{this.pending=null;});
    return this.pending;
  }
  async cancelInstall(message){
    this.emit({phase:'ready',installation:{...this.state.installation,error:message},message});
    await this.persist();
  }
}
