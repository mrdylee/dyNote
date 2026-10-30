import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {Vault} from '../core/vault.mjs';
const tools=await import('../core/journal-classification.mjs').catch(()=>({}));
const sections=await import('../core/journal-sections.mjs').catch(()=>({}));
async function fixture(t){
  assert.equal(typeof tools.JournalClassifier,'function');
  const dir=await mkdtemp(`${tmpdir()}/dynote-classify-`);t.after(()=>rm(dir,{recursive:true,force:true}));
  const root=`${dir}/vault`;await mkdir(`${root}/Journal`,{recursive:true});await mkdir(`${root}/Projects`);
  const source='# 2026-10-30\r\n\r\n## Projects\r\nText ![image](../image.png)\r\n\r\n## Second\r\nOther text\r\n';
  await writeFile(`${root}/Journal/2026-10-30.md`,source);await writeFile(`${root}/Projects/Notes.md`,'# Keep\nmanual\n');await writeFile(`${root}/image.png`,'image');
  const vault=await Vault.open(root,`${dir}/recovery`),classifier=new tools.JournalClassifier(vault);
  return {root,source,vault,classifier};
}
test('classification previews without writes, copies two sections, preserves source and avoids repeats',async t=>{
  const {root,source,vault,classifier}=await fixture(t);
  const capture=await vault.documentSnapshot(),note=capture.notes.find(n=>n.path.startsWith('Journal/'));
  const input={items:sections.journalSections(note).map(s=>({...s,sourcePath:note.path,sourceRevision:note.revision,targetPath:'Projects/Notes.md'}))};
  const preview=await classifier.preview(input);
  assert.equal(await readFile(`${root}/Projects/Notes.md`,'utf8'),'# Keep\nmanual\n');
  await classifier.apply(preview.input,preview.revision);
  assert.equal(await readFile(`${root}/Journal/2026-10-30.md`,'utf8'),source);
  const target=await readFile(`${root}/Projects/Notes.md`,'utf8');assert.match(target,/manual/);assert.match(target,/Other text/);assert.match(target,/!\[image\]\(\.\.\/image.png\)/);assert.match(target,/Journal\/2026-10-30/);
  const repeated=await classifier.preview(input);assert.equal(repeated.changes.length,0);
});
test('classification rejects stale source, changed target and traversal without overwriting files',async t=>{
  const {root,source,vault,classifier}=await fixture(t),note=(await vault.documentSnapshot()).notes.find(n=>n.path.startsWith('Journal/'));
  const item={...sections.journalSections(note)[0],sourcePath:note.path,sourceRevision:note.revision,targetPath:'Projects/Copy.md'};
  await assert.rejects(classifier.preview({items:[{...item,targetPath:'../outside.md'}]}),/경로/);
  await assert.rejects(classifier.preview({items:[{...item,targetPath:note.path}]}),/원본/);
  const preview=await classifier.preview({items:[item]});await writeFile(`${root}/Projects/Copy.md`,'manual');
  await assert.rejects(classifier.apply(preview.input,preview.revision),/변경/);
  assert.equal(await readFile(`${root}/Projects/Copy.md`,'utf8'),'manual');
  await writeFile(`${root}/${note.path}`,source+'changed');await assert.rejects(classifier.preview({items:[item]}),/변경/);
});
test('local suggestions ignore fenced headings and choose matching existing folder',()=>{
  assert.equal(typeof sections.classificationSuggestions,'function');
  const note={path:'Journal/day.md',content:'# Day\n\n## Projects\nPlanning\n```\n## Fake\n```\n## Unknown\nNothing\n'};
  const suggestions=sections.classificationSuggestions(note,[note,{path:'Projects/Plan.md',content:'# Plan'}]);
  assert.equal(suggestions.length,2);assert.equal(suggestions[0].targetPath,'Projects/Projects.md');assert.equal(suggestions[1].targetPath,'');
});
test('classification rejects conflicting reference labels rather than redirecting copied links',async t=>{
 const {root,vault,classifier}=await fixture(t);
 await writeFile(`${root}/Journal/2026-10-30.md`,'# Date\n\n## Projects\n[manual][ref]\n\n[ref]: ../image.png\n');
 await writeFile(`${root}/Projects/Notes.md`,'# Manual\n[ref]: https://example.com/different\n');
 const note=(await vault.documentSnapshot()).notes.find(n=>n.path.startsWith('Journal/'));
 await assert.rejects(classifier.preview({items:[{...sections.journalSections(note)[0],sourcePath:note.path,sourceRevision:note.revision,targetPath:'Projects/Notes.md'}]}),/참조 링크/);
});
