import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { livePreview, wikiSyntax, refreshLivePreview } from "../src/live-preview.mjs";
import assert from "node:assert/strict";

const results = [];
for (const count of [1000, 10000, 30000]) {
  const doc = Array.from({ length: count }, (_, i) => `## Note ${i}\n\n**text** *italic* [[Guide|link]]\n\n`).join("");
  for (const live of [false, true]) {
    let state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage, extensions: [wikiSyntax] }), ...(live ? [livePreview()] : [])] });
    assert.ok(ensureSyntaxTree(state, doc.length, 10000));
    state = state.update({ effects: refreshLivePreview.of(null) }).state;
    const times = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      state = state.update({ selection: { anchor: Math.floor((doc.length - 1) * i / 20) } }).state;
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    results.push({ count, chars: doc.length, live, fullyParsed: true, p50Ms: times[10], p95Ms: times[19] });
  }
}
console.log(JSON.stringify({ scope: "20 selection-only CodeMirror transactions per case; excludes DOM rendering, vault indexing, typing, and OS input", results }, null, 2));
