import test from 'node:test';
import assert from 'node:assert/strict';
const tree=await import('../core/file-tree.mjs').catch(()=>({}));
test('tree trash protects built-in/configured folders and their ancestors without blocking siblings',()=>{
 assert.equal(typeof tree.protectedTreeFolders,'function');assert.equal(typeof tree.canTrashFolder,'function');
 const protectedFolders=tree.protectedTreeFolders({daily:{folder:'Work/Daily'},weekly:{folder:'Work/Weekly',template:'Custom/Templates/Week.md'}});
 for(const path of ['Journal','Templates','Attachments','_attachments','Work','Work/Daily','Work/Weekly','Custom','Custom/Templates','journal'])assert.equal(tree.canTrashFolder(path,protectedFolders),false,path);
 for(const path of ['Project','Work/Archive','Journal/Project','Journals','Templates-old'])assert.equal(tree.canTrashFolder(path,protectedFolders),true,path);
});
