export const FILE_TREE_DRAG = "application/x-dynote-tree-file";

const builtInFolders=['Journal','Templates','Attachments','_attachments'];
const fold=value=>value.normalize('NFC').toLowerCase().replace(/\/+$/,'');
export function protectedTreeFolders(preferences={}){
 const folders=[...builtInFolders];
 for(const settings of Object.values(preferences))if(settings&&typeof settings==='object'){
  if(settings.folder?.trim())folders.push(settings.folder.trim());
  if(settings.template?.includes('/'))folders.push(settings.template.split('/').slice(0,-1).join('/'));
 }
 return [...new Set(folders)];
}
export function canTrashFolder(path,protectedFolders=[]){
 if(typeof path!=='string'||!path)return false;
 const candidate=fold(path);
 return ![...builtInFolders,...(Array.isArray(protectedFolders)?protectedFolders:[])].some(value=>typeof value==='string'&&(fold(value)===candidate||fold(value).startsWith(candidate+'/')));
}
