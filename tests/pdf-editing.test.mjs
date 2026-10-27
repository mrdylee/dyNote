import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {PDFDocument,PDFName,PDFHexString,PDFSignature} from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {Vault} from '../core/vault.mjs';
import {PdfEditor} from '../core/pdf-editing.mjs';
const original=await readFile(new URL('./fixtures/link-target.pdf',import.meta.url));
async function fixture(t){const dir=await mkdtemp(`${tmpdir()}/dynote-pdf-edit-`);t.after(()=>rm(dir,{recursive:true,force:true}));const root=`${dir}/vault`;await mkdir(root);await writeFile(`${root}/manual.pdf`,original);const vault=await Vault.open(root,`${dir}/recovery`);return {root,vault,editor:new PdfEditor(vault)};}
const highlight={kind:'highlight',path:'manual.pdf',page:2,rects:[[30,600,140,620]],color:'#ffff00',comment:'강조 메모 😀'};
async function annotations(bytes,page=2){const loading=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:true});try{const pdf=await loading.promise;return await (await pdf.getPage(page)).getAnnotations();}finally{await loading.destroy();}}
test('PDF-EDIT standard highlight survives save/reload with Unicode comment and exact recovery',async t=>{
 const {root,editor}=await fixture(t);const preview=await editor.preview(highlight);assert.deepEqual(await readFile(`${root}/manual.pdf`),original);
 const result=await editor.apply(preview.input,preview.revision),saved=await readFile(`${root}/manual.pdf`),items=await annotations(saved);
 const item=items.find(a=>a.id===result.annotationId);assert.equal(item.subtype,'Highlight');assert.equal(item.contentsObj.str,highlight.comment);assert.deepEqual(item.rect,[30,600,140,620]);assert.deepEqual([...item.color],[255,255,0]);assert.equal((await annotations(original)).length+1,items.length);
 assert.deepEqual(await readFile(result.recoveryPath),original);assert.notEqual(result.attachment.revision,preview.revision);
});
test('PDF-EDIT edit and delete selected annotation preserve other dictionaries',async t=>{
 const {root,editor}=await fixture(t);let preview=await editor.preview(highlight),result=await editor.apply(preview.input,preview.revision);const annotationId=result.annotationId;
 const before=await annotations(await readFile(`${root}/manual.pdf`));const originalItem=before.find(a=>a.id!==annotationId);
 preview=await editor.preview({kind:'edit',path:'manual.pdf',page:2,annotationId,color:'#ff0000',comment:'Changed'});await editor.apply(preview.input,preview.revision);
 let items=await annotations(await readFile(`${root}/manual.pdf`));assert.equal(items.find(a=>a.id===annotationId).contentsObj.str,'Changed');assert.deepEqual([...items.find(a=>a.id===annotationId).color],[255,0,0]);assert.deepEqual(items.find(a=>a.id===originalItem.id),originalItem);
 preview=await editor.preview({kind:'delete',path:'manual.pdf',page:2,annotationId});await editor.apply(preview.input,preview.revision);items=await annotations(await readFile(`${root}/manual.pdf`));assert.equal(items.some(a=>a.id===annotationId),false);assert.deepEqual(items.find(a=>a.id===originalItem.id),originalItem);
});
test('PDF-EDIT invalid geometry, pages, annotation IDs and stale input do not write',async t=>{
 const {root,editor}=await fixture(t);
 for(const input of [{...highlight,page:0},{...highlight,page:3},{...highlight,rects:[[30,620,140,600]]},{...highlight,rects:[[NaN,1,2,3]]},{...highlight,rects:[[-999,600,140,620]]},{...highlight,color:'red'},{...highlight,comment:'a'.repeat(10001)},{...highlight,path:'../manual.pdf'},{kind:'delete',path:'manual.pdf',page:2,annotationId:'missing'}])await assert.rejects(editor.preview(input));
 const preview=await editor.preview(highlight);await writeFile(`${root}/manual.pdf`,Buffer.concat([original,Buffer.from('\n% external')]));await assert.rejects(editor.apply(preview.input,preview.revision),/변경/);assert.equal((await readFile(`${root}/manual.pdf`)).at(-1),'l'.charCodeAt(0));
});
test('PDF-EDIT signature-bearing PDF is refused before rewriting',async t=>{
 const {root,editor}=await fixture(t),pdf=await PDFDocument.load(original);const widget=pdf.context.register(pdf.context.obj({FT:'Sig',T:PDFHexString.fromText('Signature'),Kids:[]}));pdf.catalog.set(PDFName.of('AcroForm'),pdf.context.obj({Fields:[widget]}));await writeFile(`${root}/manual.pdf`,await pdf.save());
 assert.ok((await PDFDocument.load(await readFile(`${root}/manual.pdf`))).getForm().getFields()[0] instanceof PDFSignature);await assert.rejects(editor.preview(highlight),/서명/);
});
test('PDF-EDIT geometry/color/opacity match a controlled original PDF++ highlight',async t=>{
 const observed=(await annotations(await readFile(new URL('./fixtures/pdf-plus-highlight.pdf',import.meta.url)))).find(a=>a.contentsObj.str==='Synthetic highlight only');
 const {root,editor}=await fixture(t),preview=await editor.preview({...highlight,color:'#ffd000'});const result=await editor.apply(preview.input,preview.revision),native=(await annotations(await readFile(`${root}/manual.pdf`))).find(a=>a.id===result.annotationId);
 for(const key of ['subtype','rect','quadPoints','color','opacity'])assert.deepEqual(native[key],observed[key]);
});
test('PDF-EDIT marked-encrypted input is rejected and its bytes preserved',async t=>{
 const {root,editor}=await fixture(t),pdf=await PDFDocument.load(original);pdf.context.trailerInfo.Encrypt=pdf.context.register(pdf.context.obj({Filter:'Standard'}));const bytes=Buffer.from(await pdf.save());await writeFile(`${root}/manual.pdf`,bytes);await assert.rejects(editor.preview(highlight),/encrypt|암호/i);assert.deepEqual(await readFile(`${root}/manual.pdf`),bytes);
});
