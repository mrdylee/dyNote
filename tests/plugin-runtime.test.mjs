import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createPluginRuntime } from '../src/plugin-runtime.mjs';

function fixture(t, source) {
  const dom = new JSDOM('<div id="views"></div><div id="settings"></div><div id="notices"></div>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const saved = [], published = [];
  const runtime = createPluginRuntime(dom.window, { manifest: { id: 'sample', name: 'Sample', version: '1' }, source, css: '' }, {
    request: async (kind, value) => { if (kind === 'save-data') saved.push(value); return null; },
    publish: value => published.push(value),
  }, { notes: [{ path: 'A.md', content: '# Alpha', metadata: {} }], active: 'A.md', data: { count: 2 } });
  return { runtime, window: dom.window, saved, published };
}
test('loads original CommonJS lifecycle, executes commands and removes registrations on unload', async t => {
  const f = fixture(t, `const {Plugin,ItemView}=require('obsidian');module.exports=class extends Plugin {async onload(){this.data=await this.loadData();this.registerView('sample-view',leaf=>new (class extends ItemView {async onOpen(){this.contentEl.createDiv({text:'Original view'});}})(leaf));this.addCommand({id:'show',name:'Show',callback:async()=>{const leaf=this.app.workspace.getLeftLeaf(false);await leaf.setViewState({type:'sample-view'});this.data.count++;await this.saveData(this.data);}});this.registerEvent(this.app.workspace.on('file-open',()=>this.opened=true));}};`);
  await f.runtime.load(); assert.equal(f.runtime.commands()[0].id, 'sample:show');
  await f.runtime.execute('sample:show');
  assert.match(f.window.document.querySelector('#views').textContent, /Original view/);
  assert.deepEqual(f.saved.map(x=>x.count), [3]);
  f.runtime.update({ notes: [{ path: 'B.md', content: 'Beta', metadata: {} }], active: 'B.md' });
  assert.equal(f.runtime.plugin.opened, true);
  await f.runtime.unload();
  assert.equal(f.runtime.commands().length, 0); assert.equal(f.window.document.querySelector('#views').childElementCount, 0);
});
test('fails explicitly for unsupported imports', async t => {
  const { runtime } = fixture(t, "require('node:fs');module.exports=class {};");
  await assert.rejects(runtime.load(), /node:fs|지원하지/);
});
