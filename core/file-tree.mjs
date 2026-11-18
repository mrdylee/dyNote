export const FILE_TREE_DRAG = "application/x-dynote-tree-file";

export const pathInTree = (name, root) => name === root || name.startsWith(root + '/');
export const renamedTreePath = (name, from, to) => pathInTree(name, from) ? to + name.slice(from.length) : name;

const builtInFolders=['Journal','Templates','Attachments','_attachments'];
const fold=value=>value.normalize('NFC').toLowerCase().replace(/\/+$/,'');
export function treeRenameDestination(from, name, folder) {
 const leaf=name.trim();
 if(!leaf||leaf.startsWith('.')||/[\\/\x00-\x1f]/.test(leaf))throw new Error('같은 위치에 쓸 새 이름을 입력해 주세요.');
 const original=from.split('/').at(-1);
 const extension=original.match(/\.[^.]+$/)?.[0];
 if(!folder&&extension&&!leaf.toLowerCase().endsWith(extension.toLowerCase()))
  throw new Error('기존 확장자를 유지해 주세요.');
 return from.slice(0,from.length-original.length)+leaf;
}
export function managedCopilotPath(target, records=[]) {
 const name=fold(target);
 return ['Copilot Note','AI Conversations'].some(root=>pathInTree(name,fold(root))) ||
  records.some(record=>typeof record.journalPath==='string'&&pathInTree(fold(record.journalPath),name));
}
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
