import {GitBackup,runGit} from './git-backup.mjs';
import {validFilePath} from './vault.mjs';

export class GitWorkspace {
  constructor(root){this.root=root;this.backup=new GitBackup(root);}
  git(args,options){return runGit(this.root,args,options);}
  async repository(){if(!await this.backup.repository())throw new Error('먼저 Git 저장소를 초기화해 주세요.');}
  async status(){
    if(!await this.backup.repository())return {available:false,branch:'',branches:[],files:[],excluded:0,remotes:[]};
    const [state,branch,branches,remotes]=await Promise.all([
      this.git(['status','--porcelain=v1','-z']),this.git(['symbolic-ref','--quiet','--short','HEAD'],{allow:[0,1]}),
      this.git(['for-each-ref','--format=%(refname:short)','refs/heads/']),this.git(['remote']),
    ]);
    const records=state.stdout.split('\0'),files=[];let excluded=0;
    for(let i=0;i<records.length;i++){
      const record=records[i];if(!record)continue;
      const index=record[0],worktree=record[1],path=record.slice(3);let from;
      if(/[RC]/.test(index+worktree))from=records[++i];
      if(validFilePath(path))files.push({path,index,worktree,...(from?{from}:{})});else excluded++;
    }
    return {available:true,branch:branch.stdout.trim()||'(분리된 HEAD)',branches:branches.stdout.trim().split('\n').filter(Boolean),files,excluded,remotes:remotes.stdout.trim().split('\n').filter(Boolean)};
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
