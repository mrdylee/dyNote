import {PDFDocument,PDFName,PDFHexString,PDFString,PDFRef,PDFDict,PDFSignature} from 'pdf-lib';
import {randomUUID} from 'node:crypto';
import {validFilePath} from './vault.mjs';
const refId=ref=>`${ref.objectNumber}R${ref.generationNumber||''}`;
const colors=value=>{if(typeof value!=='string'||!/^#[\da-f]{6}$/i.test(value))throw new Error('PDF 주석 색상이 올바르지 않습니다.');return [1,3,5].map(i=>parseInt(value.slice(i,i+2),16)/255);};
async function transform(bytes,input){
 if(!input||!['highlight','edit','delete'].includes(input.kind)||!validFilePath(input.path)||!/\.pdf$/i.test(input.path))throw new Error('올바른 PDF 작업을 선택해 주세요.');
 const pdf=await PDFDocument.load(bytes,{updateMetadata:false});
 if(pdf.isEncrypted)throw new Error('암호화된 PDF는 편집할 수 없습니다.');
 if(pdf.catalog.has(PDFName.of('Perms'))||(pdf.catalog.has(PDFName.of('AcroForm'))&&pdf.getForm().getFields().some(field=>field instanceof PDFSignature)))throw new Error('서명 필드가 있는 PDF는 편집할 수 없습니다.');
 if(!Number.isInteger(input.page)||input.page<1||input.page>pdf.getPageCount())throw new Error('PDF 페이지가 올바르지 않습니다.');
 const page=pdf.getPage(input.page-1);let annotationId=input.annotationId,annotation,ref;
 const comment=input.comment??'';
 if(input.kind!=='delete'&&(typeof comment!=='string'||comment.length>10000))throw new Error('주석 메모는 10,000자 이하여야 합니다.');
 const color=input.kind==='delete'?null:colors(input.color);
 if(input.kind==='highlight'){
   const rects=input.rects,box=page.getCropBox();
   if(!Array.isArray(rects)||!rects.length||rects.length>500||rects.some(rect=>!Array.isArray(rect)||rect.length!==4||rect.some(n=>!Number.isFinite(n))||rect[0]>=rect[2]||rect[1]>=rect[3]||rect[0]<box.x-1||rect[1]<box.y-1||rect[2]>box.x+box.width+1||rect[3]>box.y+box.height+1))throw new Error('PDF 선택 영역 좌표가 올바르지 않습니다.');
   const rect=[Math.min(...rects.map(r=>r[0])),Math.min(...rects.map(r=>r[1])),Math.max(...rects.map(r=>r[2])),Math.max(...rects.map(r=>r[3]))];
   annotation=pdf.context.obj({Type:'Annot',Subtype:'Highlight',Rect:rect,QuadPoints:rects.flatMap(([x1,y1,x2,y2])=>[x1,y2,x2,y2,x1,y1,x2,y1]),C:color,CA:0.2,Contents:PDFHexString.fromText(comment),T:PDFHexString.fromText('Dynote'),NM:PDFHexString.fromText(randomUUID()),F:4});
   ref=pdf.context.register(annotation);page.node.addAnnot(ref);annotationId=refId(ref);
 }else{
   const annotations=page.node.Annots();
   for(let i=0;i<(annotations?.size()||0);i++){const candidate=annotations.get(i);if(candidate instanceof PDFRef&&refId(candidate)===annotationId){ref=candidate;annotation=pdf.context.lookup(ref,PDFDict);break;}}
   if(!annotation||!['/Highlight','/Text','/Underline','/StrikeOut','/Squiggly'].includes(annotation.get(PDFName.of('Subtype'))?.toString()))throw new Error('편집할 PDF 주석을 찾을 수 없습니다.');
   if(input.kind==='delete'){
     const popup=annotation.get(PDFName.of('Popup'));if(popup instanceof PDFRef)page.node.removeAnnot(popup);
     page.node.removeAnnot(ref);
   }else{
     annotation.set(PDFName.of('Contents'),PDFHexString.fromText(comment));annotation.set(PDFName.of('C'),pdf.context.obj(color));
     annotation.delete(PDFName.of('AP'));annotation.set(PDFName.of('M'),PDFString.fromDate(new Date()));
   }
 }
 const output=await pdf.save();if(output.length>25*1024*1024)throw new Error('PDF는 25MB 이하여야 합니다.');
 return {bytes:output,annotationId:input.kind==='delete'?null:annotationId,input:{...input}};
}
export class PdfEditor{
 constructor(vault){this.vault=vault;}
 async preview(input){const file=await this.vault.readAttachment(input?.path);if(input.sourceRevision&&input.sourceRevision!==file.revision)throw new Error('열어 둔 PDF가 외부에서 변경되었습니다. 문서로 돌아간 뒤 PDF를 다시 열어 주세요.');const result=await transform(file.bytes,input);return {input:result.input,revision:file.revision,beforeBytes:file.bytes.length,afterBytes:result.bytes.length};}
 async apply(input,revision){const file=await this.vault.readAttachment(input?.path);if(file.revision!==revision)throw new Error('미리보기 이후 PDF가 변경되었습니다. 다시 확인해 주세요.');const result=await transform(file.bytes,input);return {...await this.vault.replacePdf(input.path,result.bytes,revision),annotationId:result.annotationId};}
}
