import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ESSModel } from './ESSModel';
import { arrangeContainers, LINK_PANEL_SIDES } from './ContainerLayout';
import { formatRackLabel } from './telemetry';
import { setupDiagnostics } from './diagnostics';
import { setupContactorDiagnostics } from './contactorDiagnostics';
import './style.css';
import { validEssTarget } from '../../core/ess-links.mjs';

let focusing = false;
function notify(device: string, activate = false): void {
 if (focusing) return;
 const container = Number(document.querySelector<HTMLSelectElement>('#container-select')?.value ?? 0) + 1;
 parent.postMessage({channel:'dynote-ess',type:'select',target:`ess-0${container}/${device}`,activate},'notes://app');
}

document.querySelector('#app')!.innerHTML = `<main><header><div><span class="eyebrow">ENERGY STORAGE SYSTEM</span><h1>ESS 컨테이너 · 6대</h1><p>Blender v2 재질 · 인터랙티브 3D 목업</p></div><span class="badge">6 CONTAINERS · 36 RACKS</span></header><section id="viewport"><canvas></canvas><div id="loading">모델 불러오는 중…</div><div id="rack-markers"></div><div id="container-markers"></div><aside id="telemetry"><div class="telemetry-head"><div><span class="eyebrow">MODBUS TCP</span><h2>ESS 진단 정보</h2></div><span class="simulation">SIMULATION</span></div><p class="connection">● 장비 미연결 · 예시 데이터</p><div id="rack-cards"></div><h3 class="equipment-title">제어기 진단</h3><div id="equipment-cards"></div></aside><div class="view-tools"><button id="zoom-in" aria-label="확대">＋</button><button id="zoom-out" aria-label="축소">−</button><button id="fullscreen" aria-label="전체화면">⛶</button></div><div class="hint">드래그 회전 · 휠 확대 · 우클릭 이동 · 문 클릭</div></section><footer><div class="group"><button id="open">전체 열기</button><button id="close">전체 닫기</button></div><div class="group"><button id="home">6대 전체 보기</button><label class="container-picker">컨테이너 <select id="container-select" aria-label="컨테이너 선택"><option value="0">ESS 01</option><option value="1">ESS 02</option><option value="2">ESS 03</option><option value="3">ESS 04</option><option value="4">ESS 05</option><option value="5">ESS 06</option></select></label><button id="racks">배터리 랙</button><button id="panel">내부 패널</button><button id="ebsc">eBSC</button></div><span id="status" role="status">준비 중</span></footer></main>`;
const canvas = document.querySelector('canvas')!;
canvas.setAttribute('aria-label','ESS LINK 3D 모델');
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();parent.postMessage({channel:'dynote-ess',type:'error'},'notes://app');});
const viewport = document.querySelector<HTMLElement>('#viewport')!;
const status = document.querySelector<HTMLElement>('#status')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
const scene = new THREE.Scene();
renderer.setClearColor(0x000000, 0);
const contactorBox = new THREE.Box3();
const contactorHighlight = new THREE.Box3Helper(contactorBox, 0xffbd67);
const contactorHighlightMaterial = contactorHighlight.material as THREE.LineBasicMaterial;
contactorHighlight.visible = false; contactorHighlightMaterial.depthTest = false; contactorHighlightMaterial.transparent = true; contactorHighlight.renderOrder = 10;
scene.add(contactorHighlight);
const contactorMarker = document.createElement('button');
contactorMarker.className = 'rack-marker contactor-marker'; contactorMarker.hidden = true;
contactorMarker.setAttribute('aria-label', '선택한 BPU 진단 다시 재생'); viewport.append(contactorMarker);
let contactorAnchor: THREE.Vector3 | undefined;
let contactorCamera: { position: THREE.Vector3; target: THREE.Vector3; endPosition: THREE.Vector3; endTarget: THREE.Vector3; start: number } | undefined;
function frameDiagnosis(): void {
 camera.clearViewOffset();
 const panel=document.querySelector<HTMLElement>('#contactor-diagnostics');
 if(!panel||panel.hidden)return;
 const {width,height}=viewport.getBoundingClientRect();
 camera.setViewOffset(width,height,width>680?Math.min(150,width*.18):0,width>680?0:Math.min(190,height*.25),width,height);
}
const environment = new RoomEnvironment();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(environment).texture;
environment.dispose(); pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x657075, 2.6));
for (const [x,y,z,power] of [[-5,8,6,3.2],[5,3,-5,1.8],[-6,3,-1,2]]) {const light = new THREE.DirectionalLight(0xffffff,power);light.position.set(x,y,z);scene.add(light);}
const camera = new THREE.PerspectiveCamera(40, 1, .01, 100);
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.minDistance = .22; controls.maxDistance = 80; controls.maxPolarAngle = Math.PI*.95;
controls.addEventListener('start',()=>{contactorCamera=undefined;});
function view(position: THREE.Vector3, target: THREE.Vector3): void { if(!model)return; camera.position.copy(model.root.localToWorld(position)); controls.target.copy(model.root.localToWorld(target)); controls.update(); }
function home(): void {
 models.forEach(item=>item.root.visible=true);groupOutlines.visible=true;
 document.querySelector<HTMLElement>('#container-markers')!.style.display='block';
 const center=layoutBounds.getCenter(new THREE.Vector3()),size=layoutBounds.getSize(new THREE.Vector3());
 const distance=size.length()/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*Math.min(1,camera.aspect))*1.15;
 camera.position.copy(center).add(new THREE.Vector3(-.9,1.1,1.35).normalize().multiplyScalar(distance));
 controls.target.copy(center);controls.update();
 document.querySelector<HTMLElement>('#rack-markers')!.style.display='none';
 status.textContent='4대(2×2) + 2대 · 좌우·앞뒤 0.5ft · 랙 앞문·E-panel 바깥 방향';
}
new ResizeObserver(() => {const {width,height}=viewport.getBoundingClientRect();renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();frameDiagnosis();}).observe(viewport);
let model: ESSModel | undefined;
const models: ESSModel[] = [];
const containerMarkers: { element: HTMLElement; anchor: THREE.Vector3 }[] = [];
let layoutBounds=new THREE.Box3();
const groupOutlines=new THREE.Group();scene.add(groupOutlines);
const sceneMarkers: { element: HTMLButtonElement; anchor: THREE.Vector3 }[] = [];
function createRackMarkers():void {
 const layer=document.querySelector<HTMLElement>('#rack-markers')!;layer.replaceChildren();sceneMarkers.length=0;const racks=model?.root.getObjectByName('Internal_Battery_Racks');if(!racks)return;
 racks.children.forEach((rack,index)=>{const box=new THREE.Box3().setFromObject(rack);const anchor=new THREE.Vector3((box.min.x+box.max.x)/2,box.max.y+.16,(box.min.z+box.max.z)/2);const element=document.createElement('button');element.className='rack-marker';element.dataset.rack=String(index+1);element.textContent=formatRackLabel(index+1);layer.append(element);sceneMarkers.push({element,anchor});});
 for(const [id,nodeName] of [['LCS','LCS_Controller'],['eBSC','eBSC_Controller']] as const){const node=model?.root.getObjectByName(nodeName);if(!node)continue;const box=new THREE.Box3().setFromObject(node);const anchor=new THREE.Vector3((box.min.x+box.max.x)/2,(box.min.y+box.max.y)/2,(box.min.z+box.max.z)/2);const element=document.createElement('button');element.className='rack-marker equipment-marker';element.dataset.equipment=id;element.textContent=id;layer.append(element);sceneMarkers.push({element,anchor});}
}
function showSelectedMarkers():void {groupOutlines.visible=false;models.forEach(item=>item.root.visible=item===model);document.querySelector<HTMLElement>('#container-markers')!.style.display='none';document.querySelector<HTMLElement>('#rack-markers')!.style.display='block';}
const ventButton=document.createElement('button');ventButton.textContent='환기구 열기/닫기';
ventButton.addEventListener('click',()=>{if(!model)return;const open=model.toggleVents();status.textContent=`환기 덮개 4개 ${open?'열림':'닫힘'} · 선택 컨테이너`;});
document.querySelector('#close')!.after(ventButton);
function focusPanelDevice(name:string,label:string):void {
 document.dispatchEvent(new Event('contactorclose-request'));
 if(!model)return;showSelectedMarkers();model.setAll(true);
 const node=model.root.getObjectByName(name)!;
 const target=node.getWorldPosition(new THREE.Vector3());
 camera.position.copy(target).add(name==='LCS_Controller' ? new THREE.Vector3(-.45,.07,-.66).multiply(model.root.scale).applyQuaternion(model.root.quaternion) : new THREE.Vector3(-.35,.12,1.1).multiply(model.root.scale).applyQuaternion(model.root.quaternion));
 controls.target.copy(target);controls.update();status.textContent=label;
 const device=({'LCS_Controller':'lcs','eBSC_Controller':'ebsc','Network_Switch_IE3500':'switch','Extended_Switch':'extended-switch'} as Record<string,string>)[name]||`bpu-${name.slice(-2)}`;notify(device);
}
for(const [name,label] of [['Extended_Switch','Extended Switch'],['Network_Switch_IE3500','Switch'],['LCS_Controller','LCS']]){
 const button=document.createElement('button');button.textContent=label;
 button.addEventListener('click',()=>focusPanelDevice(name,label));
 document.querySelector('#ebsc')!.before(button);
}
function selectContainer(index:number):void {
 model=models[index];if(!model)return;
 document.querySelector<HTMLSelectElement>('#container-select')!.value=String(index);
 document.dispatchEvent(new Event('containerchange'));
 notify('container');
 createRackMarkers();showSelectedMarkers();
 view(new THREE.Vector3(-7.8,5.3,10.2),new THREE.Vector3(.45,1.3,0));
 document.querySelector('#telemetry h2')!.textContent=`ESS ${String(index+1).padStart(2,'0')} 진단 정보`;
 status.textContent=`ESS ${String(index+1).padStart(2,'0')} · E-panel ${model.panelSide==='left'?'좌측형':'우측형'} (랙 앞문 기준) · 랙 양문 1–2 / 3–4 / 5–6`;
}
document.querySelector('#container-select')!.addEventListener('change',event=>selectContainer(Number((event.target as HTMLSelectElement).value)));
void setupDiagnostics();
const contactorUi = setupContactorDiagnostics();
document.addEventListener('contactorfocus', event => {
 const {rackId,diagnosis,focus}=(event as CustomEvent<{rackId:number;diagnosis:string;focus:boolean}>).detail;
 const bpu=model?.root.getObjectByName(`BPU_${String(rackId).padStart(2,'0')}`);
 if(!model||!bpu)return;
 showSelectedMarkers();
 const first=rackId%2?rackId:rackId-1;
 for(const id of [first,first+1])model.setDoor(`Door_Hinge_${String(id).padStart(2,'0')}`,true);
 contactorBox.setFromObject(bpu).expandByScalar(.025);
 contactorHighlight.visible=true;
 contactorHighlightMaterial.color.set(diagnosis==='mismatch'?0xffbd67:diagnosis==='unknown'?0xa3b5c2:0x75d9cf);
 contactorAnchor=contactorBox.getCenter(new THREE.Vector3());contactorAnchor.y=contactorBox.max.y+.12;
 contactorMarker.textContent=`${formatRackLabel(rackId)} · K+`;
 contactorMarker.dataset.diagnosis=diagnosis;
 document.querySelectorAll<HTMLElement>('.rack-marker[data-rack]').forEach(marker=>marker.classList.toggle('selected',Number(marker.dataset.rack)===rackId));
 frameDiagnosis();
 if(focus){
  const target=contactorBox.getCenter(new THREE.Vector3());target.y+=.2;
  const endPosition=target.clone().add(new THREE.Vector3(0,.3,3.6).multiply(model.root.scale).applyQuaternion(model.root.quaternion));
  if(reducedMotion){camera.position.copy(endPosition);controls.target.copy(target);controls.update();}
  else contactorCamera={position:camera.position.clone(),target:controls.target.clone(),endPosition,endTarget:target,start:performance.now()};
 }
 status.textContent=`ESS ${models.indexOf(model)+1} · ${formatRackLabel(rackId)} · Contactor 진단 · 가상 시연`;
});
document.addEventListener('contactorclose',()=>{contactorCamera=undefined;contactorHighlight.visible=false;contactorAnchor=undefined;contactorMarker.hidden=true;document.querySelectorAll('.rack-marker.selected').forEach(marker=>marker.classList.remove('selected'));frameDiagnosis();});
contactorMarker.addEventListener('click',()=>document.querySelector<HTMLButtonElement>('#contactor-issue')!.click());
document.addEventListener('rackfocus', event => {
 if(viewport.classList.contains('contactor-mode'))return;
 const rackId=(event as CustomEvent<number>).detail;
 const rack=model?.root.getObjectByName('Internal_Battery_Racks')?.children[rackId-1];
 if(!model||!rack)return;
 showSelectedMarkers();
 const first=rackId%2?rackId:rackId-1;
 for(const id of [first,first+1])model.setDoor(`Door_Hinge_${String(id).padStart(2,'0')}`,true);
 const box=new THREE.Box3().setFromObject(rack);
 const target=box.getCenter(new THREE.Vector3());
 const size=box.getSize(new THREE.Vector3());
 const distance=Math.max(size.y,size.x/camera.aspect)/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))*1.55;
 camera.position.copy(target).add(new THREE.Vector3(0,.15,distance).multiply(model.root.scale).applyQuaternion(model.root.quaternion));
 controls.target.copy(target);controls.update();
 status.textContent=`ESS ${models.indexOf(model)+1} · ${formatRackLabel(rackId)} 확대 · 배터리 랙 버튼으로 복귀`;
});
const raycaster = new THREE.Raycaster(); let down = new THREE.Vector2();
canvas.addEventListener('pointerdown', event => {down.set(event.clientX,event.clientY);});
canvas.addEventListener('pointerup', event => {
 if (event.button !== 0 || !model || down.distanceTo(new THREE.Vector2(event.clientX,event.clientY))>5) return;
 const rect=canvas.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);
 const hit=raycaster.intersectObjects(models.filter(item=>item.root.visible).map(item=>item.root),true)[0]; if(hit){ const owner=models.find(item=>{let node:THREE.Object3D|null=hit.object;while(node){if(node===item.root)return true;node=node.parent;}return false;}); if(owner && document.querySelector<HTMLElement>('#container-markers')!.style.display!=='none'){selectContainer(models.indexOf(owner));notify('container',true);return;} let part:THREE.Object3D|null=hit.object;
 while(part){
  let device='';
  if(/^Battery_Rack_\d{2}$/.test(part.name))device=`rack-${part.name.slice(-2)}`;
  if(/^BPU_\d{2}$/.test(part.name))device=`bpu-${part.name.slice(-2)}`;
  device=({'LCS_Controller':'lcs','eBSC_Controller':'ebsc','Network_Switch_IE3500':'switch','Extended_Switch':'extended-switch'} as Record<string,string>)[part.name]||device;
  if(device){notify(device,true);break;}
  part=part.parent;
 }
 const name=owner?.toggleObject(hit.object);if(name)status.textContent=`ESS ${models.indexOf(owner!)+1} · ${name.startsWith('Vent_Hinge')?`환기 덮개 ${Number(name.slice(-2))}·${Number(name.slice(-2))%2 ? Number(name.slice(-2))+1 : Number(name.slice(-2))-1} 조작`:name.startsWith('Door_Hinge')?'랙 양문 조작':'장비실 문 조작'}`;}
});
function on(id:string, action:()=>void):void{document.getElementById(id)!.addEventListener('click',action);}
on('open',()=>{models.forEach(item=>item.setAll(true));status.textContent='컨테이너 6대 모든 문 열기';});
on('close',()=>{models.forEach(item=>item.setAll(false));status.textContent='컨테이너 6대 모든 문 닫기';});
on('home',home);
function zoom(factor:number):void{const offset=camera.position.clone().sub(controls.target);offset.setLength(THREE.MathUtils.clamp(offset.length()*factor,controls.minDistance,controls.maxDistance));camera.position.copy(controls.target).add(offset);controls.update();}
on('zoom-in',()=>zoom(.8));on('zoom-out',()=>zoom(1.25));
on('fullscreen',()=>{if(document.fullscreenElement)void document.exitFullscreen();else void document.documentElement.requestFullscreen().catch(()=>{status.textContent='이 브라우저에서는 전체화면을 사용할 수 없습니다.';});});
on('racks',()=>{showSelectedMarkers();model?.setAll(true);view(new THREE.Vector3(2.5,3.8,9.5),new THREE.Vector3(0,1.35,0));status.textContent='랙 6개 · 각 7팩';});
on('panel',()=>{showSelectedMarkers();model?.setAll(true);view(new THREE.Vector3(-6.4,1.8,.3),new THREE.Vector3(-2.5,1.12,.3));status.textContent='내부 장비와 문 안쪽 FACP';});
on('ebsc',()=>{if(!model)return;showSelectedMarkers();model.setAll(true);const node=model.root.getObjectByName('eBSC_Controller')!;const target=node.getWorldPosition(new THREE.Vector3());camera.position.copy(target).add(new THREE.Vector3(-.3,.06,1.1).multiply(model.root.scale).applyQuaternion(model.root.quaternion));controls.target.copy(target);controls.update();status.textContent='eBSC · LAN 포트 4개';});
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
let previous=performance.now();renderer.setAnimationLoop(time=>{const dt=(time-previous)/1000;previous=time;models.forEach(item=>item.update(dt));if(contactorCamera){const t=Math.min(1,(time-contactorCamera.start)/650),e=t*t*(3-2*t);camera.position.lerpVectors(contactorCamera.position,contactorCamera.endPosition,e);controls.target.lerpVectors(contactorCamera.target,contactorCamera.endTarget,e);if(t===1)contactorCamera=undefined;}controls.update();contactorHighlightMaterial.opacity=contactorMarker.dataset.diagnosis==='mismatch'&&!reducedMotion ? .7+Math.sin(time*.004)*.2 : .8;renderer.render(scene,camera);const {width,height}=viewport.getBoundingClientRect();for(const marker of [...sceneMarkers,...containerMarkers,...(contactorAnchor?[{element:contactorMarker,anchor:contactorAnchor}]:[])]){const point=marker.anchor.clone().project(camera);marker.element.hidden=point.z < -1 || point.z > 1;const x=(point.x*.5+.5)*width,y=(-point.y*.5+.5)*height;marker.element.style.transform=`translate(${x}px,${y}px) translate(-50%,-50%)`;if(marker.element===contactorMarker)contactorUi.position(x,y);}});
async function loadModel():Promise<void>{
try {
 model=await ESSModel.load('./ess/ess-container.glb');
 for(let index=0;index<6;index++){
  const instance=index===0?model:model.clone(LINK_PANEL_SIDES[index]);
  instance.root.name=`ESS_${index+1}`;models.push(instance);scene.add(instance.root);
 }
 layoutBounds=arrangeContainers(models.map(instance=>instance.root));
 models.forEach((instance,index)=>{
  const element=document.createElement('button');element.className='container-marker';element.textContent=`ESS ${String(index+1).padStart(2,'0')} · E-panel ${instance.panelSide==='left'?'L':'R'}`;
  document.querySelector<HTMLSelectElement>('#container-select')!.options[index].textContent=`ESS ${String(index+1).padStart(2,'0')} · E-panel ${instance.panelSide==='left'?'좌측형':'우측형'}`;
  element.addEventListener('click',()=>{selectContainer(index);notify('container',true);});document.querySelector('#container-markers')!.append(element);
  const center=new THREE.Box3().setFromObject(instance.root).getCenter(new THREE.Vector3());center.y=3.5;
  containerMarkers.push({element,anchor:center});
 });
 for(const [indices,label] of [[[0,1,2,3],'4대 묶음 · LINK 01–04'],[[4,5],'2대 묶음 · LINK 05–06']] as const){
  const box=new THREE.Box3();indices.forEach(index=>box.union(new THREE.Box3().setFromObject(models[index].root)));
  const points=[[box.min.x-.3,box.min.z-.3],[box.max.x+.3,box.min.z-.3],[box.max.x+.3,box.max.z+.3],[box.min.x-.3,box.max.z+.3]].map(([x,z])=>new THREE.Vector3(x,.02,z));
  groupOutlines.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0x69aeb0,transparent:true,opacity:.6})));
  const element=document.createElement('span');element.className='container-group-marker';element.textContent=label;
  document.querySelector('#container-markers')!.append(element);
  containerMarkers.push({element,anchor:new THREE.Vector3(box.getCenter(new THREE.Vector3()).x,.1,box.max.z+.8)});
 }
 createRackMarkers();document.getElementById('loading')!.remove();home();document.dispatchEvent(new Event('modelready'));parent.postMessage({channel:'dynote-ess',type:'ready'},'notes://app');
}
catch(error){document.getElementById('loading')!.textContent='모델을 불러오지 못했습니다. 서버 주소로 접속했는지 확인하세요.';parent.postMessage({channel:'dynote-ess',type:'error'},'notes://app');console.error(error);}
}
document.addEventListener('click',event=>{
 const element=(event.target as Element).closest<HTMLElement>('[data-rack],[data-equipment]');
 if(element?.dataset.rack)notify(`rack-${String(element.dataset.rack).padStart(2,'0')}`,true);
 else if(element?.dataset.equipment)notify(element.dataset.equipment.toLowerCase(),true);
},true);
for(const [id,device] of [['ebsc','ebsc']])document.getElementById(id)!.addEventListener('click',()=>notify(device));
window.addEventListener('message',event=>{
 if(event.source!==parent||event.origin!=='notes://app'||event.data?.channel!=='dynote-ess'||event.data.type!=='focus'||!validEssTarget(event.data.target)||!model)return;
 const [container,device]=event.data.target.split('/');
 focusing=true;
 try {
  selectContainer(Number(container.slice(-2))-1);
  if(device.startsWith('rack-'))document.dispatchEvent(new CustomEvent('rackfocus',{detail:Number(device.slice(-2))}));
  else if(device!=='container'){
   const name=({'lcs':'LCS_Controller','ebsc':'eBSC_Controller','switch':'Network_Switch_IE3500','extended-switch':'Extended_Switch'} as Record<string,string>)[device]||`BPU_${device.slice(-2)}`;
   focusPanelDevice(name,device);
  }
 } finally {focusing=false;}
 notify(device);
});
void loadModel();
