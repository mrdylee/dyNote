import {GitBackup,runGit,validateGitConfig} from './git-backup.mjs';
import {validFilePath} from './vault.mjs';
import {localOnlyFiles} from './git-file-status.mjs';
import {createHash,randomUUID} from 'node:crypto';

function displayRemoteUrl(value){
  if(!/^[a-z][\w+.-]*:\/\//i.test(value))return value;
  try{
    const url=new URL(value);
    if(url.username&&['http:','https:'].includes(url.protocol))url.username='***';
    if(url.password)url.password='***';
    url.search='';url.hash='';
    return url.href;
  }catch{return value.replace(/^(https?:\/\/)[^/]*@/i,'$1***@').replace(/^([a-z][\w+.-]*:\/\/[^/@:]+):[^/@]*@/i,'$1:***@').split(/[?#]/,1)[0];}
}

export class GitWorkspace {
  constructor(root){this.root=root;this.backup=new GitBackup(root);}
  git(args,options){return runGit(this.root,args,options);}
  async repository(){if(!await this.backup.repository())throw new Error('먼저 Git 저장소를 초기화해 주세요.');}
  async repositoryInfo(){
    if(!await this.backup.repository())return {available:false,branch:'',remotes:[],remoteUrls:[]};
    const [branch,remotes]=await Promise.all([
      this.git(['symbolic-ref','--quiet','HEAD'],{allow:[0,1]}),this.git(['remote']),
    ]);
    const names=remotes.stdout.trim().split('\n').filter(Boolean);
    const branchName=branch.stdout.trim().replace(/^refs\/heads\//,'');
    let suggestedRemote='';
    const remoteUrls=await Promise.all(names.map(async name=>{
      const [fetch,push]=await Promise.all(['url','pushurl'].map(key=>this.git(['config','--null','--get-all',`remote.${name}.${key}`],{allow:[0,1]})));
      const read=value=>value.stdout.split('\0').filter(Boolean).map(displayRemoteUrl),fetchUrls=read(fetch),pushUrls=read(push);
      if(name==='origin' && fetchUrls.length===1 && (!push.stdout || push.stdout===fetch.stdout)) {
        try { suggestedRemote=validateGitConfig({remote:fetch.stdout.split('\0')[0],branch:branchName}).remote; }
        catch { /* Only suggest a URL suitable for both reading and writing. */ }
      }
      return {name,fetch:fetchUrls,push:pushUrls.length?pushUrls:fetchUrls};
    }));
    return {available:true,branch:branchName||'(분리된 HEAD)',branchName,suggestedRemote,remotes:names,remoteUrls};
  }
  async status(){
    const info=await this.repositoryInfo();
    if(!info.available)return {...info,branches:[],files:[],excluded:0};
    const [state,branches]=await Promise.all([
      this.git(['status','--porcelain=v1','--untracked-files=all','-z']),
      this.git(['for-each-ref','--format=%(refname:short)','refs/heads/']),
    ]);
    const records=state.stdout.split('\0'),files=[];let excluded=0;
    for(let i=0;i<records.length;i++){
      const record=records[i];if(!record)continue;
      const index=record[0],worktree=record[1],path=record.slice(3);let from;
      if(/[RC]/.test(index+worktree))from=records[++i];
      if(validFilePath(path))files.push({path,index,worktree,...(from?{from}:{})});else excluded++;
    }
    return {...info,branches:branches.stdout.trim().split('\n').filter(Boolean),files,excluded};
  }
  async checkPath(path){
    if(!validFilePath(path))throw new Error('허용되지 않는 노트 경로입니다.');
    if(!(await this.backup.safePaths()).includes(path))throw new Error('문서 경로가 변경되었습니다. 새로고침해 주세요.');
  }
  async diff(path,staged=false){
    await this.repository();await this.checkPath(path);
    const result=await this.git(['diff','--no-ext-diff','--no-textconv','--no-color',...(staged?['--cached']:[]),'--',path]);
    return result.stdout.slice(0,128*1024)+(result.stdout.length>128*1024?'\n… 차이 표시를 128KB로 제한했습니다.':'');
  }
  async clean(){if((await this.git(['status','--porcelain=v1','-z'])).stdout)throw new Error('변경사항을 먼저 커밋하거나 별도로 보관해 주세요.');}
  async branch(value){
    if(typeof value!=='string'||!value||value.startsWith('-')||value.length>200)throw new Error('올바른 브랜치 이름을 입력해 주세요.');
    try{await this.git(['check-ref-format','--branch',value]);}catch{throw new Error('올바른 브랜치 이름을 입력해 주세요.');}
    return value;
  }
  async teamDestination(branch,config){
    const setup=message=>({phase:'setup',message});
    const values=async key=>(await this.git(['config','--null','--get-all',key],{allow:[0,1]})).stdout.split('\0').filter(Boolean);
    const [tracking,merges,pushRemote,pushDefault,{stdout}]=await Promise.all([
      values(`branch.${branch}.remote`),values(`branch.${branch}.merge`),values(`branch.${branch}.pushRemote`),
      values('remote.pushDefault'),this.git(['remote']),
    ]);
    const names=stdout.trim().split('\n').filter(Boolean);
    let saved;
    if(config){
      try { saved=validateGitConfig(config); } catch { return setup('팀 노트 Git 설정에서 원격 주소와 브랜치를 확인해 주세요.'); }
      if(config.mode==='personal-sync')return setup('팀 노트 전용 Git 저장소를 연결해 주세요.');
    }
    if(tracking.length!==merges.length || tracking.length>1 || (merges.length && !merges[0].startsWith('refs/heads/')))
      return setup('현재 팀 브랜치의 추적 브랜치를 하나로 지정해 주세요.');
    const remoteBranch=merges[0]?.slice('refs/heads/'.length) || branch;
    const addresses=async name=>{
      const urls=await Promise.all([[],['--push']].map(async flags=>
        (await this.git(['remote','get-url','--all',...flags,'--',name])).stdout.trim().split('\n')));
      return {name,url:urls[0].length===1 && urls[1].length===1 && urls[0][0]===urls[1][0] ? urls[0][0] : null};
    };
    const addressForUrl=async url=>{
      const name='dynote-team-'+randomUUID();
      const {stdout}=await this.git(['-c',`remote.${name}.url=${url}`,'remote','-v'],{env:{...process.env,LC_ALL:'C',LANGUAGE:'C'}});
      const entries=stdout.split('\n').filter(line=>line.startsWith(name+'\t')).map(line=>line.slice(name.length+1));
      const fetch=entries.find(line=>line.endsWith(' (fetch)'))?.slice(0,-8);
      return entries.length===2 && fetch && entries.includes(fetch+' (push)') ? fetch : null;
    };
    const savedUrl=saved && await addressForUrl(saved.remote);
    if(saved && !savedUrl)return setup('팀 설정 주소의 가져오기와 업로드 대상이 다릅니다. Git 주소 변환 설정을 확인해 주세요.');
    const candidates=await Promise.all(names.map(name=>addresses(name)));
    const matching=candidates.filter(candidate=>candidate.url===savedUrl);
    const native=tracking.length ? candidates.find(candidate=>candidate.name===tracking[0])
      : candidates.length===1 && candidates[0].name==='origin' ? candidates[0] : matching.length===1 ? matching[0] : null;
    if((tracking.length || names.length) && !native?.url)
      return setup('팀 브랜치가 추적할 원격을 지정하고 가져오기와 업로드 주소를 하나로 맞춰 주세요.');
    if(saved && (saved.branch!==remoteBranch || (native && savedUrl!==native.url)))
      return setup('팀 노트 Git 설정과 현재 추적 원격의 주소·브랜치가 다릅니다. 팀 저장소를 확인해 주세요.');
    if(!native && !saved?.push)return setup('팀 노트 Git 설정에서 원격 주소·브랜치를 연결하고 업로드를 켜 주세요.');
    const pushRules=pushRemote.length ? pushRemote : pushDefault;
    if(pushRules.some(name=>name!==native?.name))
      return setup('현재 브랜치의 가져오기 원격과 업로드 원격이 다릅니다. 팀 Git 설정을 확인해 주세요.');
    if(native){
      const rules=await values(`remote.${native.name}.push`);
      const simple=new Set([...(branch===remoteBranch ? [branch,`refs/heads/${branch}`] : []),
        `HEAD:refs/heads/${remoteBranch}`,`${branch}:${remoteBranch}`,`refs/heads/${branch}:refs/heads/${remoteBranch}`]);
      if(rules.length>1 || rules.some(rule=>!simple.has(rule)))
        return setup('팀 저장소의 별도 업로드 규칙을 확인하고 현재 추적 브랜치를 지정해 주세요.');
    }
    const url=native?.url ?? savedUrl;
    if(await addressForUrl(url)!==url)return setup('팀 저장소 주소가 Git 설정에서 다른 주소로 다시 연결됩니다. 가져오기와 업로드 주소를 확인해 주세요.');
    let upstream=native && (await this.git(['for-each-ref','--format=%(upstream)','refs/heads/'+branch])).stdout.trim();
    if(native && !upstream){
      const ref=`refs/remotes/${native.name}/${remoteBranch}`;
      if(!(await this.git(['rev-parse','--verify','--quiet',ref],{allow:[0,1]})).code)upstream=ref;
    }
    return {url,remoteBranch,upstream:upstream?.startsWith('refs/remotes/') ? upstream : null,author:saved ?? {}};
  }
  async syncTeam(config){
    if(!await this.backup.repository())return {phase:'setup',message:'팀 노트 Git 저장소를 먼저 연결해 주세요.'};
    const branch=(await this.git(['symbolic-ref','--quiet','--short','HEAD'],{allow:[0,1]})).stdout.trim();
    if(!branch)return {phase:'setup',message:'팀 저장소에서 동기화할 로컬 브랜치를 선택해 주세요.'};
    const target=await this.teamDestination(branch,config);
    if(target.phase)return target;
    await this.backup.assertReady({branch});
    const head=async ref=>(await this.git(['rev-parse','--verify','--quiet',ref],{allow:[0,1]})).stdout.trim();
    const ancestor=async (a,b)=>!(await this.git(['merge-base','--is-ancestor',a,b],{allow:[0,1]})).code;
    const ref='refs/heads/'+target.remoteBranch;
    const key=createHash('sha256').update(target.url+'\0'+ref).digest('hex');
    const refs=['refs/dynote-team/remotes/'+key,...(target.upstream ? [target.upstream] : [])];
    const seen=await Promise.all(refs.map(head));
    const remote=await this.backup.remoteHead({remote:target.url,branch:target.remoteBranch});
    const previous=await head('HEAD');
    if(remote){
      // Fetch objects without replacing the user's FETCH_HEAD or their tracking reference before validation.
      await this.git(['fetch','--no-tags','--no-recurse-submodules','--no-write-fetch-head','--refmap=','--',target.url,ref]);
      for(const known of seen)if(known && !await ancestor(known,remote))
        throw new Error('원격 팀 브랜치의 이력이 재작성되었습니다. 양쪽 기록을 확인해 주세요.');
      if(previous && (await this.git(['merge-base',previous,remote],{allow:[0,1]})).code)
        throw new Error('팀 저장소와 공통 Git 이력이 없습니다. 저장소와 브랜치를 확인해 주세요.');
    } else if(seen.some(Boolean) || (await this.git(['ls-remote','--refs','--',target.url])).stdout)
      throw new Error('원격 팀 브랜치가 없거나 삭제되었습니다. 팀 저장소와 브랜치를 확인해 주세요.');
    for(const oid of new Set([remote,previous].filter(Boolean)))
      if((await this.git(['ls-tree','--name-only',oid,'--','.dynote-sync'])).stdout)
        throw new Error('개인 노트 동기화 기록이 있는 저장소입니다. 팀 전용 저장소를 확인해 주세요.');
    await this.backup.assertReady({branch});
    // Native Git knows which CRLF checkouts match their stored blobs. Stage actual edits with their original bytes.
    const state=await this.git(['--no-optional-locks','status','--porcelain=v1','--no-renames','--untracked-files=all','-z'],{nativeCheckout:true});
    const dirty=new Set(state.stdout.split('\0').filter(Boolean).map(row=>row.slice(3)));
    if(dirty.size)await this.backup.checkpoint(target.author,(await this.backup.safePaths()).filter(name=>dirty.has(name)));
    const local=await head('HEAD');
    let next=local || remote;
    if(remote && local && remote!==local && !await ancestor(remote,local)){
      if(await ancestor(local,remote))next=remote;
      else {
        const result=await this.git(['merge-tree','--write-tree','--no-messages',local,remote],{allow:[0,1]});
        if(result.code)throw new Error('팀 노트의 변경사항이 충돌합니다. 양쪽 원문은 Git 커밋에 보존했습니다. Git에서 충돌을 해결한 뒤 다시 동기화해 주세요.');
        const author=[];
        if(target.author.authorName)author.push('-c','user.name='+target.author.authorName);
        if(target.author.authorEmail)author.push('-c','user.email='+target.author.authorEmail);
        next=(await this.git([...author,'commit-tree','--no-gpg-sign',result.stdout.trim(),'-p',local,'-p',remote,'-m','팀 노트 동기화'])).stdout.trim();
      }
    }
    if(next && next!==local){
      await this.backup.assertReady({branch});
      if(await head('HEAD')!==local)throw new Error('팀 브랜치가 변경되었습니다. 다시 동기화해 주세요.');
      const applied=await this.git(['merge','--ff-only','--no-overwrite-ignore','--no-autostash','--',next],{allow:[0,1,128],nativeCheckout:true});
      if(applied.code)throw new Error('받을 파일과 같은 경로에 로컬 변경이 있거나 파일을 교체할 수 없습니다. 로컬 파일을 확인한 뒤 다시 동기화해 주세요.');
    }
    if(next && next!==remote){
      // Require both ancestry and the exact observed remote tip. A rewind or concurrent deletion can never be pushed over.
      if(remote && !await ancestor(remote,next))throw new Error('원격 팀 브랜치의 이력을 보호하기 위해 업로드를 중지했습니다.');
      await this.git(['push','--porcelain','--no-verify','--no-follow-tags','--recurse-submodules=no',
        '--force-with-lease='+ref+':'+(remote || ''),'--',target.url,next+':'+ref]);
    }
    if(next)for(const [i,tracking] of refs.entries()){
      if(await head(tracking)!==next)await this.git(['update-ref',tracking,next,seen[i] || '0'.repeat(next.length)]);
    }
    const files=await localOnlyFiles(args=>this.git(args),validFilePath);
    return {phase:'synced',message:'팀 노트 동기화됨'+(files.length ? ' · 이 기기에만 있는 파일 '+files.length+'개' : ''),localOnlyFiles:files};
  }
  async action(input){
    if(!input || typeof input.kind!=='string')throw new Error('Git 작업을 선택해 주세요.');
    if(input.kind==='init'){
      if(!await this.backup.repository())await this.git(['init','--initial-branch=main']);
      return this.status();
    }
    await this.repository();
    if(input.kind==='stage'||input.kind==='unstage'){
      await this.checkPath(input.path);
      if(input.kind==='stage')await this.git(['add','--',input.path]);
      else {
        const head=await this.git(['rev-parse','--verify','HEAD'],{allow:[0,128]});
        await this.git(head.code===0?['reset','--',input.path]:['rm','--cached','--force','--ignore-unmatch','--',input.path]);
      }
    } else if(input.kind==='commit'){
      if(typeof input.message!=='string'||!input.message.trim()||input.message.length>4096||input.message.includes('\0'))throw new Error('커밋 메시지를 입력해 주세요.');
      const names=(await this.git(['diff','--cached','--name-only','-z'])).stdout.split('\0').filter(Boolean);
      if(!names.length)throw new Error('먼저 변경 파일을 스테이징해 주세요.');
      if(names.some(name=>!validFilePath(name)))throw new Error('노트 이외의 스테이징 파일이 있습니다. 외부 Git 도구에서 먼저 확인해 주세요.');
      await this.git(['commit','--message',input.message]);
    } else if(input.kind==='fetch'||input.kind==='pull'){
      const state=await this.status(),remote=input.remote || (state.remotes.includes('origin')?'origin':state.remotes[0]);
      if(!remote || !state.remotes.includes(remote) || remote.startsWith('-'))throw new Error('원격 저장소를 먼저 연결해 주세요.');
      if(input.kind==='fetch')await this.git(['fetch','--',remote]);
      else {await this.clean();await this.git(['pull','--no-rebase','--ff-only','--no-autostash']);}
    } else if(['create-branch','switch-branch','delete-branch'].includes(input.kind)){
      const branch=await this.branch(input.branch);
      await this.clean();
      if(input.kind==='create-branch')await this.git(['switch','-c',branch]);
      else if(input.kind==='switch-branch')await this.git(['switch','--',branch]);
      else await this.git(['branch','-d','--',branch]);
    } else throw new Error('지원하지 않는 Git 작업입니다.');
    return this.status();
  }
}
