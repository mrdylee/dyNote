import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, EditorSelection } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { history, undo, redo } from "@codemirror/commands";
import { runTextColor } from "../src/editorCommands.mjs";
import { renderMarkdown, buildKnowledge } from "../core/knowledge.mjs";
import { readColorSpan } from "../core/text-color.mjs";
import { wikiSyntax, livePreview, livePreviewState } from "../src/live-preview.mjs";
const span=(text,color="#c62828")=>`<span style="color:${color}">${text}</span>`;
const openLength=span("").indexOf("</span>");
function view(doc,from,to=from,readonly=false) {
  const view={state:EditorState.create({doc,selection:{anchor:from,head:to},extensions:[history(),markdown({base:markdownLanguage,extensions:[wikiSyntax]}),EditorState.readOnly.of(readonly)]}),dispatch:tr=>{view.state=view.state.update(tr).state;},focus(){}};
  return view;
}
test("selected Korean text color saves valid span, selection and one-step undo/redo",()=>{
  const editor=view("앞 한글 뒤",2,4);assert.equal(runTextColor(editor,"#C62828"),true);
  assert.equal(editor.state.doc.toString(),`앞 ${span("한글")} 뒤`);
  assert.equal(editor.state.sliceDoc(editor.state.selection.main.from,editor.state.selection.main.to),"한글");
  undo(editor);assert.equal(editor.state.doc.toString(),"앞 한글 뒤");redo(editor);
  runTextColor(editor,"#1565c0");assert.equal(editor.state.doc.toString(),`앞 ${span("한글","#1565c0")} 뒤`);
  runTextColor(editor,null);assert.equal(editor.state.doc.toString(),"앞 한글 뒤");
});
test("empty selection places caret inside color; read-only or invalid colors cannot edit",()=>{
  const editor=view("",0);runTextColor(editor,"#c62828");assert.equal(editor.state.doc.toString(),span(""));assert.equal(editor.state.selection.main.head,openLength);
  const locked=view("한글",0,2,true);assert.equal(runTextColor(locked,"#c62828"),false);assert.equal(locked.state.doc.toString(),"한글");
  const plain=view("한글",0,2);for(const color of ["red","#fff","red;background:url(x)","#c62828\" onclick=\"x"])assert.equal(runTextColor(plain,color),false);
});
test("color reset affects only selected text inside a colored range",()=>{
  const doc=span("가나다라"),editor=view(doc,openLength+1,openLength+3);runTextColor(editor,null);
  assert.equal(editor.state.doc.toString(),span("가")+"나다"+span("라"));
});
test("colored Markdown preserves bold and renders safe color in reading view",()=>{
  const html=renderMarkdown(span("**한글**"),[],"Home.md");
  assert.match(html,/<span style="color:#c62828"><strong>한글<\/strong><\/span>/);
  const source=span("앞 "+span("안쪽","#1565c0")+" 뒤");const range=readColorSpan(source,0);
  assert.equal(range.to,source.length);assert.equal(range.color,"#c62828");
  assert.match(renderMarkdown(source,[],"Home.md"),/color:#1565c0/);
});
test("arbitrary HTML, CSS and event attributes stay inert; code and escaped spans stay literal",()=>{
  for(const raw of ['<span style="color:red">x</span>','<span style="color:#c62828;background:red">x</span>','<span onclick="alert(1)" style="color:#c62828">x</span>','<script>alert(1)</script>']) {
    assert.equal(readColorSpan(raw,0),null);assert.doesNotMatch(renderMarkdown(raw,[],"Home.md"),/<span|<script/);
  }
  for(const raw of ['`'+span("한글")+'`','\\'+span("한글"),'```html\n'+span("한글")+'\n```']) assert.doesNotMatch(renderMarkdown(raw,[],"Home.md"),/<span style=/);
  assert.equal(readColorSpan(span("`</span>` 한글"),0).to,span("`</span>` 한글").length);
  assert.equal(readColorSpan('<span style="color:#c62828">unclosed',0),null);
});
test("Live Preview colors text, hides only wrappers and reveals syntax at cursor",()=>{
  const doc=span("**한글**")+"\n\n끝";
  let state=EditorState.create({doc,selection:{anchor:doc.length},extensions:[markdown({base:markdownLanguage,extensions:[wikiSyntax]}),livePreview()]});
  const decorations=()=>{const values=[];state.field(livePreviewState).decorations.between(0,doc.length,(from,to,value)=>values.push({from,to,spec:value.spec}));return values;};
  assert.ok(decorations().some(r=>r.spec.attributes?.style==="color:#c62828"));
  assert.ok(decorations().some(r=>r.from===0&&r.to===openLength&&!r.spec.class));
  state=state.update({selection:{anchor:31}}).state;
  assert.ok(!decorations().some(r=>r.from===0&&r.to===openLength&&!r.spec.class));
});

test("partial color reset preserves colored text at both selection boundaries",()=>{
  for(const [from,to,before,plain,after] of [[0,2,"","가나","다라"],[2,4,"가나","다라",""]]) {
    const editor=view(span("가나다라"),openLength+from,openLength+to);runTextColor(editor,null);
    assert.equal(editor.state.doc.toString(),(before?span(before):"")+plain+(after?span(after):""));
  }
});
test("changing current color at a caret retains caret position and content",()=>{
  const editor=view(span("가나다"),openLength+1);runTextColor(editor,"#1565c0");
  assert.equal(editor.state.doc.toString(),span("가나다","#1565c0"));
  assert.equal(editor.state.selection.main.empty,true);assert.equal(editor.state.selection.main.head,openLength+1);
});
test("multiline color preserves paragraph breaks in reading view",()=>{
  const editor=view("한글\n\nEnglish",0,11);runTextColor(editor,"#1565c0");
  const html=renderMarkdown(editor.state.doc.toString(),[],"Home.md");
  assert.match(html,/<p><span style="color:#1565c0">한글<\/span><\/p>/);
  assert.match(html,/<p><span style="color:#1565c0">English<\/span><\/p>/);
});

test("coloring complete headings and nested lists preserves Markdown block structure",()=>{
  for (const doc of ["# Heading\n\nParagraph", "- One\n  - **Two**\n- Three", "> Quote\n\n1. First\n2. Second"]) {
    const editor=view(doc,0,doc.length);runTextColor(editor,"#1565c0");
    const colored=renderMarkdown(editor.state.doc.toString(),[],"Home.md");
    const plain=renderMarkdown(doc,[],"Home.md");
    assert.equal(colored.replace(/<span style="color:#[a-f0-9]{6}">|<\/span>/g,""),plain);
  }
});
test("partial color reset preserves enclosing bold formatting and surrounding colors",()=>{
  const doc=span("**가나다라**"),from=doc.indexOf("나다"),editor=view(doc,from,from+2);
  runTextColor(editor,null);
  const html=renderMarkdown(editor.state.doc.toString(),[],"Home.md");
  assert.match(html,/<strong><span style="color:#c62828">가<\/span>나다<span style="color:#c62828">라<\/span><\/strong>/);
  assert.equal(editor.state.sliceDoc(editor.state.selection.main.from,editor.state.selection.main.to),"나다");
  undo(editor);assert.equal(editor.state.doc.toString(),doc);
});
test("coloring preserves task and table syntax and literal code blocks",()=>{
  const doc="- [ ] task\n\n|A|B|\n|-|-|\n|C|D|\n\n```js\nconst value=1;\n```";
  const editor=view(doc,0,doc.length);runTextColor(editor,"#1565c0");
  const html=renderMarkdown(editor.state.doc.toString(),[],"Home.md");
  assert.match(html,/<table>/);assert.match(html,/<input[^>]*type="checkbox"/);
  assert.match(html,/<code class="language-js">const value=1;/);
  assert.doesNotMatch(editor.state.doc.toString(),/```js\n<span/);
});

test("colored heading anchors match knowledge index while inline code keeps literal markup",()=>{
  for (const doc of ["# Heading", "# **Heading** [link](Guide.md)", '# `<span style="color:#c62828">literal</span>` Heading']) {
    const editor=view(doc,0,doc.length);runTextColor(editor,"#1565c0");
    const before=buildKnowledge([{path:"Home.md",content:doc}]).notes[0].headings[0].id;
    const after=buildKnowledge([{path:"Home.md",content:editor.state.doc.toString()}]).notes[0].headings[0].id;
    assert.equal(after,before);assert.match(renderMarkdown(editor.state.doc.toString(),[],"Home.md"),new RegExp(`id="${before}"`));
  }
});
test("multiple color selections in the same span reset safely in one undo step",()=>{
  const doc=span("가나다라마"),editor=view(doc,openLength,openLength+1);
  editor.state=EditorState.create({doc,selection:EditorSelection.create([EditorSelection.range(openLength,openLength+1),EditorSelection.range(openLength+3,openLength+4)]),extensions:[history(),markdown({base:markdownLanguage,extensions:[wikiSyntax]}),EditorState.allowMultipleSelections.of(true)]});
  runTextColor(editor,null);assert.equal(editor.state.doc.toString(),"가"+span("나다")+"라"+span("마"));
  undo(editor);assert.equal(editor.state.doc.toString(),doc);
});

test("coloring near the start of a partially parsed large document preserves every trailing byte",()=>{
  const tail="unchanged tail **text**\n\n".repeat(10000),doc="# Heading\n\n"+tail,editor=view(doc,2,9);
  runTextColor(editor,"#1565c0");
  assert.equal(editor.state.doc.toString(),"# "+span("Heading","#1565c0")+"\n\n"+tail);
});
