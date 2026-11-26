import assert from 'node:assert/strict';
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import electronPath from 'electron';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';

const {_electron} = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || 'playwright');
const root = await mkdtemp(path.join(tmpdir(), 'dynote-pdf-highlighter-'));
const profile = path.join(root, 'profile'), vault = path.join(root, 'vault');
const file = path.join(vault, 'manual.pdf');
let app;
try {
  await mkdir(profile); await mkdir(vault);
  await writeFile(path.join(profile, 'settings.json'), JSON.stringify({vaultRoot: vault}));
  await copyFile('tests/fixtures/link-target.pdf', file);
  const original = await readFile(file);
  app = await _electron.launch({executablePath: process.env.DYNOTE_EXECUTABLE || electronPath, args: process.env.DYNOTE_EXECUTABLE ? [] : ['.'], env: {...process.env, OPEN_NOTES_DATA: profile}});
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('button', {name: '파일 목록', exact: true}).click();
  const open = async () => {
    await page.locator('.file-tree [title="manual.pdf"]').first().click();
    await page.locator('.pdf-page[aria-busy="false"]').waitFor();
  };
  const pen = page.getByRole('button', {name: '형광펜', exact: true});
  const drag = async (start, end) => {
    const span = page.locator('.native-pdf-text span').first();
    await span.scrollIntoViewIfNeeded();
    const box = await span.boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + start * box.width, y);
    await page.mouse.down();
    await page.mouse.move(box.x + end * box.width, y, {steps: 5});
    await page.mouse.up();
  };
  await open();
  await drag(0.01, 0.25);
  assert.deepEqual(await readFile(file), original);
  await pen.click();
  await drag(0.01, 0.25);
  await page.locator('.pdf-pen-stroke').first().waitFor();
  const firstStroke = await page.locator('.pdf-pen-stroke').first().evaluate(stroke => {
    const rect = stroke.getBoundingClientRect(), canvas = document.querySelector('.pdf-page canvas').getBoundingClientRect();
    const points = Array.from(stroke.style.clipPath.matchAll(/([\d.-]+)%\s+([\d.-]+)%/g), m => [Number(m[1]),Number(m[2])]);
    return {x:rect.left-canvas.left,y:rect.top-canvas.top,width:rect.width,height:rect.height,points};
  });
  assert.ok(firstStroke.points.length > 4);
  assert.equal(await page.locator('.pdf-pen-stroke').first().evaluate(el=>getComputedStyle(el).opacity),'0.35');
  await page.getByLabel('형광펜 색상').fill('#00ff00');
  await drag(0.62, 0.98);
  await page.getByRole('button', {name: '문서로 돌아가기', exact: true}).click();
  await page.locator('.pdf-viewer').waitFor({state: 'detached'});
  await open();
  const job = getDocument({data: new Uint8Array(await readFile(file)), useSystemFonts: true});
  try {
    const pdf = await job.promise;
    const marks = await (await pdf.getPage(1)).getAnnotations();
    assert.deepEqual(marks.map(mark => [mark.subtype, ...mark.color]), [['Highlight',255,255,0], ['Highlight',0,255,0]]);
    assert.ok(marks.every(mark=>mark.opacity===0.35));
  } finally { await job.destroy(); }
  const colored = await page.locator('.pdf-page canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let yellow = 0, green = 0;
    for (let i=0; i<pixels.length; i+=4) {
      if (pixels[i]===255 && pixels[i+1]===255 && Math.abs(pixels[i+2]-166)<=1) yellow++;
      if (pixels[i+1] - pixels[i] > 35 && pixels[i+1] - pixels[i+2] > 35) green++;
    }
    return {yellow, green};
  });
  assert.ok(colored.yellow > 10 && colored.green > 10);
  const shape = await page.locator('.pdf-page canvas').evaluate((canvas, stroke) => {
    const ctx = canvas.getContext('2d'), outline = new Path2D();
    stroke.points.forEach(([x,y],i) => outline[i ? 'lineTo' : 'moveTo'](stroke.x+x*stroke.width/100,stroke.y+y*stroke.height/100));
    outline.closePath();
    const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let inside=0, outside=0, filled=0, clear=0;
    for(let y=Math.ceil(stroke.y); y<Math.floor(stroke.y+stroke.height); y++){
      for(let x=Math.ceil(stroke.x); x<Math.floor(stroke.x+stroke.width); x++){
        const i=4*(y*canvas.width+x);
        if(pixels[i]<220)continue; // Exclude text and its antialiasing.
        const yellow=pixels[i]-pixels[i+2]>25;
        if(ctx.isPointInPath(outline,x+0.5,y+0.5)){inside++;if(yellow)filled++;}
        else{outside++;if(!yellow)clear++;}
      }
    }
    return {inside,outside,filled,clear};
  },firstStroke);
  assert.ok(shape.inside>0 && shape.outside>0 && shape.filled/shape.inside>0.94 && shape.clear/shape.outside>0.85,
    'The reopened PDF must retain the pen outline: '+JSON.stringify(shape));
  await mkdir('output/playwright', {recursive: true});
  await page.locator('.native-pdf-text span').first().screenshot({path:'output/playwright/pdf-highlighter-reopened.png'});
  await page.getByRole('button', {name: '다음 페이지', exact: true}).click();
  await page.getByText('Second page select me', {exact:true}).waitFor();
  await pen.click();
  await drag(0.35, 0.7);
  await page.getByText('저장됨', {exact:true}).waitFor();
  await pen.click();
  await page.getByText('Second page select me', {exact:true}).waitFor();
  await page.waitForFunction(() => document.querySelector('.pdf-annotation-tools summary')?.textContent.includes('2개'));
  assert.equal(await page.getByLabel('PDF 페이지', {exact:true}).inputValue(), '2');
  await pen.click();
  const changed = Buffer.concat([await readFile(file), Buffer.from('\n% external revision\n')]);
  await writeFile(file, changed);
  await drag(0.1, 0.3);
  await page.locator('.pdf-message').getByText(/형광펜 저장 실패/).waitFor();
  assert.equal(await page.locator('.pdf-pen-stroke').count(), 0);
  assert.deepEqual(await readFile(file), changed);
  assert.deepEqual(errors, []);
  console.log('PDF pen mode, color, immediate close/reopen, visible saved highlights, page retention and conflict rollback passed.');
} finally {
  await app?.close();
  await rm(root, {recursive: true, force: true});
}
