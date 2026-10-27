import {BrowserWindow,session} from 'electron';
import {safeWebViewerUrl} from '../core/security.mjs';
let configured=false;
export async function openWebViewer(input,parent) {
  const url=safeWebViewerUrl(input),partition='dynote-web-viewer',webSession=session.fromPartition(partition);
  if(!configured){webSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));webSession.setPermissionCheckHandler(()=>false);webSession.on('will-download',event=>event.preventDefault());configured=true;}
  const child=new BrowserWindow({parent,width:1100,height:800,title:`Dynote 웹 · ${new URL(url).host}`,webPreferences:{partition,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  const guard=(event,target)=>{try{safeWebViewerUrl(target);}catch{event.preventDefault();}};
  child.webContents.on('will-navigate',guard);child.webContents.on('will-redirect',guard);
  child.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  child.on('page-title-updated',event=>event.preventDefault());
  child.webContents.on('did-navigate',(_event,target)=>{try{child.setTitle(`Dynote 웹 · ${new URL(safeWebViewerUrl(target)).host}`);}catch{}});
  const closeChild=()=>{if(!child.isDestroyed())child.destroy();};
  parent.once('closed',closeChild);child.once('closed',()=>parent.removeListener('closed',closeChild));
  try{await child.loadURL(url);}catch{if(!child.isDestroyed())child.destroy();throw new Error('웹 페이지를 열지 못했습니다. 주소와 연결 상태를 확인해 주세요.');}
  return true;
}
