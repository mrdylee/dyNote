import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { EditorState, EditorSelection } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { history, undo, redo } from "@codemirror/commands";
import { runTextColor, runTextSize, runHighlight } from "../src/editorCommands.mjs";
import { renderMarkdown, buildKnowledge, searchNotes } from "../core/knowledge.mjs";
import { readStyleSpan } from "../core/text-color.mjs";
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
  const source=span("앞 "+span("안쪽","#1565c0")+" 뒤");const range=readStyleSpan(source,0);
  assert.equal(range.to,source.length);assert.equal(range.value,"#c62828");
  assert.match(renderMarkdown(source,[],"Home.md"),/color:#1565c0/);
});
test("arbitrary HTML, CSS and event attributes stay inert; code and escaped spans stay literal",()=>{
  for(const raw of ['<span style="color:red">x</span>','<span style="color:#c62828;background:red">x</span>','<span onclick="alert(1)" style="color:#c62828">x</span>','<script>alert(1)</script>']) {
    assert.equal(readStyleSpan(raw,0),null);assert.doesNotMatch(renderMarkdown(raw,[],"Home.md"),/<span|<script/);
  }
  for(const raw of ['`'+span("한글")+'`','\\'+span("한글"),'```html\n'+span("한글")+'\n```']) assert.doesNotMatch(renderMarkdown(raw,[],"Home.md"),/<span style=/);
  assert.equal(readStyleSpan(span("`</span>` 한글"),0).to,span("`</span>` 한글").length);
  assert.equal(readStyleSpan('<span style="color:#c62828">unclosed',0),null);
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
  const code=JSDOM.fragment(html).querySelector("code.language-js");
  assert.equal(code.textContent,"const value=1;\n");
  assert.equal(code.querySelector("[style]"),null);
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

const sized = (text, size = "1.25em") => `<span style="font-size:${size}">${text}</span>`;

test("relative size affects only selected text, retains color and supports a one-step undo", () => {
  const original = "앞 " + span("가나다") + " 뒤";
  const from = original.indexOf("나"), editor = view(original, from, from + 1);
  assert.equal(runTextSize(editor, "1.25em"), true);
  assert.equal(editor.state.doc.toString(), "앞 " + span("가" + sized("나") + "다") + " 뒤");
  assert.equal(editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to), "나");
  runTextSize(editor, "1.5em");
  assert.equal(editor.state.doc.toString(), "앞 " + span("가" + sized("나", "1.5em") + "다") + " 뒤");
  runTextSize(editor, null);
  assert.equal(editor.state.doc.toString(), original);
  undo(editor);
  assert.match(renderMarkdown(editor.state.doc.toString(), [], "Home.md"), /color:#c62828">가<span style="font-size:1.5em">나/);
});

test("color can be applied after size, and resetting part of the size retains color throughout", () => {
  const editor = view("가나다", 0, 3);
  runTextSize(editor, "1.5em");
  runTextColor(editor, "#1565c0");
  const doc = editor.state.doc.toString(), from = doc.indexOf("나");
  editor.dispatch({ selection: { anchor: from, head: from + 1 } });
  runTextSize(editor, null);
  assert.equal(editor.state.doc.toString(), span(sized("가", "1.5em") + "나" + sized("다", "1.5em"), "#1565c0"));
});

test("sized headings, live preview, formatting, literal blocks and navigation agree", () => {
  const doc = "# **제목**\n\n```md\n코드\n```", editor = view(doc, 0, doc.length);
  runTextSize(editor, "1.5em");
  const saved = editor.state.doc.toString();
  assert.equal(saved, "# **" + sized("제목", "1.5em") + "**\n\n```md\n코드\n```");
  assert.match(renderMarkdown(saved, [], "Home.md"), /<h1 id="제목"><strong><span style="font-size:1.5em">제목<\/span><\/strong><\/h1>/);
  assert.equal(buildKnowledge([{ path: "Home.md", content: saved }]).notes[0].headings[0].id, "제목");
  const state = EditorState.create({ doc: saved, extensions: [markdown({ base: markdownLanguage, extensions: [wikiSyntax] }), livePreview()] });
  const styles = [];
  state.field(livePreviewState).decorations.between(0, saved.length, (_from, _to, value) => styles.push(value.spec.attributes?.style));
  assert.ok(styles.includes("font-size:1.5em"));
});

test("invalid sizes stay literal, read-only editors do not resize", () => {
  const editor = view("한글", 0, 2);
  for (const value of ["2px", "200em", "1.25em;color:red", "url(x)"]) {
    assert.equal(runTextSize(editor, value), false);
    assert.doesNotMatch(renderMarkdown(sized("한글", value), [], "Home.md"), /<span/);
  }
  assert.equal(runTextSize(view("한글", 0, 2, true), "1.25em"), false);
});

test("resizing repeatedly does not compound font sizes, even before typing into a new span", () => {
  const editor = view("", 0);
  for (const size of ["1.25em", "1.5em", "1.5em"]) {
    runTextSize(editor, size);
    assert.equal(editor.state.doc.toString(), sized("", size));
  }
  runTextSize(editor, null);
  assert.equal(editor.state.doc.toString(), "");
});

test("sized notes retain natural titles, searchable phrases, literal code and link targets", () => {
  const literal = sized("literal");
  const content = "---\ntags: [note]\n---\n# 서식 " + sized("노트") + "\n\n쪽" + sized("지") + " 고정 [[Target|연결]]\n\n~~~html\n" + literal + "\n~~~";
  const [note] = buildKnowledge([{ path: "Note.md", content }, { path: "Target.md", content: "연결" }]).notes;
  assert.equal(note.content, content);
  assert.equal(note.title, "서식 노트");
  assert.equal(note.links[0].target, "Target");
  assert.ok(note.searchText.includes(literal));
  assert.equal(searchNotes([note], '"쪽지 고정"')[0].path, "Note.md");
  const legacy = buildKnowledge([{ path: "Legacy.md", content: "도입\r\r쪽" + sized("지") + " 고정" }]).notes;
  assert.equal(searchNotes(legacy, '"쪽지 고정"')[0].path, "Legacy.md");
});

test("sizing or coloring a whole callout preserves its title and styles the body", () => {
  const header = "> [!NOTE] 메모";
  const doc = header + "\n> 본문";
  for (const apply of [editor => runTextSize(editor, "1.5em"), editor => runTextColor(editor, "#1565c0")]) {
    const editor = view(doc, 0, doc.length);
    assert.equal(apply(editor), true);
    const result = editor.state.doc.toString();
    assert.equal(result.split("\n")[0], header);
    const html = renderMarkdown(result, [], "Home.md");
    assert.match(html, /class="callout-title">메모<\/strong>/);
    assert.match(html, /<span style="[^"]+">본문<\/span>/);
    undo(editor);
    assert.equal(editor.state.doc.toString(), doc);
  }
});

test("yellow highlight survives rendering and clears independently of bold and text color", () => {
  const source = span("**검토** 계속");
  const start = source.indexOf("검토");
  const editor = view(source, start, start + 2);
  assert.equal(runHighlight(editor, true), true);
  const marked = editor.state.doc.toString();
  assert.match(renderMarkdown(marked, [], "Home.md"), /<strong><span style="background-color:#ffe58a">검토<\/span><\/strong>/);
  assert.equal(runHighlight(editor, false), true);
  assert.equal(editor.state.doc.toString(), source);
  undo(editor);
  assert.equal(editor.state.doc.toString(), marked);
  const unsafe = '<span style="background-color:#ffe58a;display:none">a</span>';
  assert.equal(readStyleSpan(unsafe), null);
});
