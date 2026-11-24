import {gitAssetRevision, gitAssetUrl, isGitUpdateSource, readGitUpdateManifest} from './git-update-source.mjs';
const repository='https://github.com/mrdylee/dyNote';
function version(value) {
  const match=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(value || '');
  if(!match)return null;
  for(const field of [match[4],match[5]])if(field && field.split('.').some(part=>!part || !/^[0-9A-Za-z-]+$/.test(part)))return null;
  if(match[4]?.split('.').some(part=>/^0\d+$/.test(part)))return null;
  const numbers=match.slice(1,4).map(Number);if(numbers.some(n=>!Number.isSafeInteger(n)))return null;
  return {numbers,pre:match[4]?.split('.') || []};
}
function compare(a,b) {
  for(let i=0;i<3;i++)if(a.numbers[i]!==b.numbers[i])return a.numbers[i]>b.numbers[i]?1:-1;
  if(!a.pre.length || !b.pre.length)return a.pre.length===b.pre.length?0:a.pre.length?-1:1;
  for(let i=0;i<Math.max(a.pre.length,b.pre.length);i++){
    const x=a.pre[i],y=b.pre[i];if(x===y)continue;if(x===undefined)return -1;if(y===undefined)return 1;
    const xn=/^\d+$/.test(x),yn=/^\d+$/.test(y);
    if(xn&&yn){if(BigInt(x)===BigInt(y))continue;return BigInt(x)>BigInt(y)?1:-1;}
    if(xn!==yn)return xn?-1:1;
    return x>y?1:-1;
  }
  return 0;
}
export function matchesUpdateAsset(name, {platform, arch, installed}) {
  if (!/^Dynote-[a-z0-9._-]{1,150}$/i.test(name)) return false;
  if (platform === 'win32' && installed) {
    return arch === 'x64' && /-windows-x64-Setup\.exe$/i.test(name);
  }
  const platforms = {darwin: 'mac|macos|darwin', win32: 'windows|win32', linux: 'linux'};
  return !!platforms[platform] && ['x64', 'arm64'].includes(arch)
    && new RegExp(`-(?:${platforms[platform]})-${arch}\\.zip$`, 'i').test(name);
}
export function validateInternalFeedUrl(value) {
  const url = typeof value === 'string' && URL.parse(value);
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname.endsWith('/')) {
    throw new Error('사내 Git 저장소(.git) 또는 latest.json 파일의 HTTPS 주소를 입력해 주세요.');
  }
  return url.href;
}

export function allowedUpdateAsset(url, name, internalFeedUrl) {
  if (url.username || url.password) return false;
  if (internalFeedUrl == null) return url.origin === 'https://github.com' && url.pathname.startsWith('/mrdylee/dyNote/releases/download/');
  if (isGitUpdateSource(internalFeedUrl)) {
    return /^Dynote-[a-z0-9._-]+$/i.test(name) && !!gitAssetRevision(internalFeedUrl, url, name);
  }
  return /^Dynote-[a-z0-9._-]+$/i.test(name) && url.href === new URL(name, validateInternalFeedUrl(internalFeedUrl)).href;
}

function safeAssets(item,target,internalFeedUrl) {
  return (Array.isArray(item.assets)?item.assets:[]).flatMap(asset=>{
    try {
      const url=new URL(asset.browser_download_url),name=String(asset.name||'배포 파일').slice(0,200);
      if(!allowedUpdateAsset(url,name,internalFeedUrl))return [];
      if (target && !matchesUpdateAsset(name, target)) return [];
      return [{name,url:url.href,size:Number.isSafeInteger(asset.size)&&asset.size>0?asset.size:null,digest:/^sha256:[a-f0-9]{64}$/i.test(asset.digest||'')?asset.digest.toLowerCase():null}];
    }catch{return [];}
  });
}
export function releaseInformation(feed,current,includePrerelease=false,target,internalFeedUrl=null) {
  if(!Array.isArray(feed))throw new Error('업데이트 서버 응답이 올바르지 않습니다.');
  const installed=version(current);if(!installed)throw new Error('현재 앱 버전을 확인할 수 없습니다.');
  const releases=feed.flatMap(item=>{
    if(!item || typeof item.tag_name!=='string')return [];
    const parsed=version(item.tag_name);
    if(!parsed || item.draft===true || (!includePrerelease&&(item.prerelease===true||parsed.pre.length)))return [];
    const assets=safeAssets(item,target,internalFeedUrl);
    return target&&!assets.length?[]:[{item,parsed,assets}];
  }).sort((a,b)=>compare(b.parsed,a.parsed));
  const selected=releases[0];if(!selected)return {current,available:false,latest:null};
  const {item,parsed,assets}=selected;
  return {current,available:compare(parsed,installed)>0,latest:{tag:item.tag_name,name:String(item.name||item.tag_name).slice(0,300),body:String(item.body||'').slice(0,64000),publishedAt:item.published_at||null,prerelease:item.prerelease===true||!!parsed.pre.length,url:internalFeedUrl == null ? `${repository}/releases/tag/${encodeURIComponent(item.tag_name)}` : null,assets}};
}
export async function checkReleaseInformation(current,includePrerelease=false,target,internalFeedUrl=null,fetcher=fetch) {
  if (internalFeedUrl !== null) {
    const url = validateInternalFeedUrl(internalFeedUrl);
    let manifest, revision;
    if (isGitUpdateSource(url)) {
      ({manifest, revision} = await readGitUpdateManifest(url));
    } else {
      const response = await fetcher(url, {redirect:'error', cache:'no-store', signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error(`사내 업데이트 정보를 가져오지 못했습니다. 서버 응답 ${response.status}`);
      manifest = await response.json();
    }
    const {version:number, name, size, sha256} = manifest ?? {};
    if (typeof number !== 'string' || number.startsWith('v') || !version(number) || name !== `Dynote-${number}-windows-x64-Setup.exe`
        || !Number.isSafeInteger(size) || size <= 0 || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256)) {
      throw new Error('사내 latest.json의 버전 또는 설치 파일 검증 정보가 올바르지 않습니다.');
    }
    const asset = {name, size, digest:'sha256:'+sha256, browser_download_url:revision ? gitAssetUrl(url, revision, name) : new URL(name, url).href};
    return {...releaseInformation([{tag_name:'v'+number, assets:[asset]}], current, includePrerelease, target, url), checkedAt:new Date().toISOString()};
  }
  const response=await fetcher('https://api.github.com/repos/mrdylee/dyNote/releases?per_page=30',{headers:{Accept:'application/vnd.github+json','User-Agent':`Dynote/${current}`},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error(`업데이트 정보를 가져오지 못했습니다. 서버 응답 ${response.status}`);
  return {...releaseInformation(await response.json(),current,includePrerelease,target),checkedAt:new Date().toISOString()};
}
