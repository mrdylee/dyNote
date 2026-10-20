const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || 'playwright');
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const count = Number(process.argv[2] || 1000), root = process.cwd();
const vaultRoot = await mkdtemp(`${tmpdir()}/dynote-quality-vault-`);
for (let offset = 0; offset < count; offset += 100) await Promise.all(Array.from({length:Math.min(100,count-offset)}, (_,j) => {const i=offset+j; return writeFile(`${vaultRoot}/Note-${String(i).padStart(5,'0')}.md`, `# Note ${i}\n[[Note-${String((i+1)%count).padStart(5,'0')}]] [[Note-${String((i+31)%count).padStart(5,'0')}]]\n`); }));
await mkdir('output/quality', {recursive:true});
const reports=[];
for(const version of (process.env.DYNOTE_COMPARE_VERSIONS || '0.5.0,0.6.0,current').split(',')) {
 const profile=await mkdtemp(`${tmpdir()}/dynote-quality-profile-`);
 await writeFile(profile+'/settings.json',JSON.stringify({vaultRoot}));
 const app=await electron.launch({executablePath:version === 'current' ? `${root}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron` : `${root}/release/v${version}/Dynote-darwin-arm64/Dynote.app/Contents/MacOS/Dynote`,args:version === 'current' ? ['.'] : [],env:{...process.env,OPEN_NOTES_DATA:profile},timeout:30000});
 try {
 const page=await app.firstWindow(); const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1420,1000);w.setIgnoreMouseEvents(true);});
 await page.getByRole('button',{name:'그래프 보기',exact:true}).waitFor();
 await page.addStyleTag({content:'.graph-stage {position:fixed !important; left:0 !important; top:0 !important; width:1000px !important; height:700px !important; min-height:0 !important; z-index:1000 !important;}'});
 await page.evaluate(()=>{
 window.probe={points:[],frames:0,draws:0,renders:[],inputs:[]};const W=Worker;
 window.Worker=class extends W {constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.type==='frame'){const p=window.probe;p.frames++;p.points=Array.from(new Float32Array(data.buffer));p.settled=data.settled;}});}};
 for(const api of [WebGLRenderingContext,WebGL2RenderingContext])for(const name of ['drawArrays','drawElements']){const fn=api.prototype[name];api.prototype[name]=function(...args){window.probe.draws++;return fn.apply(this,args);};}
 const raf=requestAnimationFrame;window.requestAnimationFrame=fn=>raf(t=>{const p=window.probe,start=performance.now(),before=p.draws;fn(t);if(p.draws>before){p.renders.push(performance.now()-start);if(p.input){p.inputs.push(performance.now()-p.input);p.input=0;}}});
 });
 await page.getByRole('button',{name:'그래프 보기',exact:true}).click();
 await page.waitForFunction(()=>window.probe.settled===true,null,{timeout:60000});
 await page.waitForTimeout(300);
 const idle=await page.evaluate(()=>[window.probe.frames,window.probe.draws]);await page.waitForTimeout(600);
 assert.deepEqual(await page.evaluate(()=>[window.probe.frames,window.probe.draws]),idle);
 await page.evaluate(()=>{window.probe.renders=[];});
 for(let i=0;i<60;i++) {await page.evaluate(i=>{window.probe.input=performance.now();document.querySelector('.graph-stage canvas').dispatchEvent(new KeyboardEvent('keydown',{key:i%2?'ArrowLeft':'ArrowRight',bubbles:true}));},i); await page.waitForTimeout(30);}
 const report=await page.evaluate(()=>{const p=window.probe,p95=a=>a.slice().sort((a,b)=>a-b)[Math.floor(a.length*.95)];return {frames:p.frames,points:p.points,renderP95:p95(p.renders),inputP95:p95(p.inputs),heap:performance.memory?.usedJSHeapSize,canvas:[document.querySelector('.graph-stage canvas').clientWidth,document.querySelector('.graph-stage canvas').clientHeight]};});
 report.hash=createHash('sha256').update(new Float32Array(report.points)).digest('hex');delete report.points;report.version=version;report.count=count;report.errors=errors;assert.deepEqual(errors,[]);
 // Fixed camera zoom for a direct label readability comparison.
 await page.evaluate(()=>{const c=document.querySelector('.graph-stage canvas');const zoom=parseInt(document.querySelector('.graph-controls span').textContent)/100;c.dispatchEvent(new WheelEvent('wheel',{deltaY:-Math.log(.4/zoom)/.0015,clientX:500,clientY:350,bubbles:true,cancelable:true}));});
 await page.waitForTimeout(500);
 await page.locator('.graph-stage').screenshot({path:`output/quality/v${version}-${count}.png`});
 reports.push(report);console.log(JSON.stringify(report));
 } finally {await app.close();}
}
for (const report of reports) assert.equal(reports[0].hash,report.hash,'same graph must produce identical settled coordinates');
await writeFile(`output/quality/comparison-${count}.json`,JSON.stringify({reports,note:'Sequential app runs (current means development Electron), identical generated notes and 1000x700 canvas. Render callback excludes GPU completion; synthetic input excludes OS latency. Single run.'},null,2));
