import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import electronPath from 'electron';

const {_electron} = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || 'playwright');
const root = await mkdtemp(path.join(tmpdir(), 'dynote-selection-'));
const profile = path.join(root, 'profile'), vault = path.join(root, 'vault');
let app;
try {
  await mkdir(profile);
  await mkdir(vault);
  await writeFile(path.join(profile, 'settings.json'), JSON.stringify({vaultRoot:vault}));
  await writeFile(path.join(vault, 'Selection.md'),
    'Plain selected words\n\n<span style="background-color:#ffe58a">Yellow marked words</span>\n');
  app = await _electron.launch({executablePath:process.env.DYNOTE_EXECUTABLE || electronPath, args:process.env.DYNOTE_EXECUTABLE ? [] : ['.'], env:{...process.env, OPEN_NOTES_DATA:profile}});
  const page = await app.firstWindow();
  await page.getByRole('button', {name:'파일 목록', exact:true}).click();
  await page.locator('.file-row[title="Selection.md"]').click();
  for (const mode of ['편집 보기','Live Preview','읽기 보기']) {
    await page.getByRole('button', {name:mode, exact:true}).click();
    const surface = page.locator(mode === '읽기 보기' ? '.markdown-preview' : '.cm-content');
    for (const word of ['Plain','Yellow']) {
      const box = await surface.evaluate((el, word) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode, start = node.data.indexOf(word);
          if (start < 0) continue;
          const range = document.createRange();
          range.setStart(node,start);
          range.setEnd(node,start + word.length);
          return range.getBoundingClientRect().toJSON();
        }
        throw Error(word);
      },word);
      const x = box.left + 0.5, y = box.top + box.height/2;
      const clip = {x:Math.ceil(x+1),y:Math.ceil(box.top+1),width:Math.floor(box.width-4),height:Math.floor(box.height-2)};
      const sample = async () => {
        const png = await page.screenshot({clip});
        return app.evaluate(({nativeImage}, data) => {
          const pixels = nativeImage.createFromBuffer(Buffer.from(data,'base64')).toBitmap();
          const counts = new Map();
          for(let i=0;i<pixels.length;i+=4) {
            const rgb = pixels.readUInt32LE(i) & 0xffffff;
            counts.set(rgb,(counts.get(rgb) || 0)+1);
          }
          const [rgb] = [...counts].sort((a,b)=>b[1]-a[1])[0];
          return [rgb>>16,(rgb>>8)&255,rgb&255];
        },png.toString('base64'));
      };
      const before = await sample();
      await page.mouse.move(x,y);
      await page.mouse.down();
      await page.mouse.move(box.right-0.5,y,{steps:6});
      for(const phase of ['drag','release']) {
        if (phase === 'release') await page.mouse.up();
        const after = await sample();
        const selected = await surface.evaluate(el => {
          const view = el.cmTile?.root.view;
          if (!view) return window.getSelection().toString();
          const {from,to} = view.state.selection.main;
          return view.state.sliceDoc(from,to);
        });
        assert.ok(selected.length > 0, mode+' '+phase+' must keep a text selection');
        assert.ok(Math.max(...after.map((c,i)=>Math.abs(c-before[i])))>=45,
          mode+' '+word+' '+phase+' selection is indistinct: '+before+' -> '+after);
      }
      await page.mouse.click(box.right+1,y);
    }
  }
  console.log('Mouse selection is visible during drag and after release in Markdown source, Live Preview and reading view.');
} finally {
  await app?.close();
  await rm(root,{recursive:true,force:true});
}
