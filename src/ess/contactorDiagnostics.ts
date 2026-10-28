import { formatRackLabel } from './telemetry';
import { contactorPlaybackFrame, type ContactorScenario } from './contactor';

export function setupContactorDiagnostics(): { position: (x: number, y: number) => void } {
  const viewport = document.querySelector<HTMLElement>('#viewport')!;
  const button = document.createElement('button');
  button.id = 'contactor-demo'; button.textContent = 'Contactor 진단'; button.disabled = true;
  button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'contactor-diagnostics');
  document.querySelector('footer .group')!.append(button);
  const panel = document.createElement('aside');
  panel.id = 'contactor-diagnostics'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Contactor 진단 말풍선');
  panel.innerHTML = `<div class="ct-context"><span id="contactor-container">ESS 01</span><span class="ct-divider">/</span><select id="contactor-rack" aria-label="진단 대상 랙">${[1,2,3,4,5,6].map(id => `<option value="${id}">${formatRackLabel(id)}</option>`).join('')}</select><button class="ct-close" aria-label="진단 말풍선 닫기">닫기</button></div>
    <div class="ct-title"><h2>K+ Contactor</h2><span class="ct-source">시뮬레이션</span></div>
    <div class="ct-summary" aria-live="polite"><span class="ct-status" id="contactor-result"></span><p id="contactor-reason"></p></div>
    <div class="ct-readings"><div><span>제어 명령</span><strong id="contactor-command">CLOSED</strong></div><div><span>접점 피드백</span><strong id="contactor-feedback">CLOSED</strong></div></div>
    <div class="ct-chart-heading"><span>명령과 피드백</span><div class="ct-legend"><span class="ct-command-key">명령</span><span class="ct-feedback-key">피드백</span></div></div>
    <canvas id="contactor-chart" role="img" aria-label="시간에 따른 개방 명령과 접점 피드백 비교"></canvas>
    <div class="ct-scrubber"><button id="contactor-play" aria-label="시연 일시정지">일시정지</button><input id="contactor-time" aria-label="시연 재생 위치" type="range" min="0" max="2.6" step="0.02" value="0"><span id="contactor-elapsed">0.0s</span></div>
    <div class="ct-stages" aria-label="진단 진행 단계"><span id="ct-stage-command">개방 명령</span><span id="ct-stage-feedback">상태 확인</span><span id="ct-stage-diagnosis">진단 결과</span></div>
    <div class="ct-actions"><button id="contactor-issue">이슈 발생</button><button id="contactor-compare">정상 동작과 비교</button></div>
    <details class="ct-details"><summary>판단 근거 · 시연 정보</summary><p id="contactor-evidence"></p><p>실장비 미연결 · 가상 신호 및 판정 시간. 3D 강조는 BPU 외함 위치이며 내부 접점 위치는 미확인입니다.</p><button id="contactor-offline">통신 끊김 시연</button></details>`;
  const tether = document.createElement('div'); tether.id = 'contactor-tether'; tether.hidden = true;
  tether.setAttribute('aria-hidden', 'true'); viewport.append(tether, panel);
  const rackSelect = panel.querySelector<HTMLSelectElement>('#contactor-rack')!;
  const timeInput = panel.querySelector<HTMLInputElement>('#contactor-time')!;
  const playButton = panel.querySelector<HTMLButtonElement>('#contactor-play')!;
  const chart = panel.querySelector<HTMLCanvasElement>('#contactor-chart')!;
  let rackId = 2, scenario: ContactorScenario = 'mismatch', elapsed = 0, running = false, frameId = 0;
  let previousTime = 0, lastDiagnosis = '', anchorX = 0, anchorY = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const containerId = (): number => Number(document.querySelector<HTMLSelectElement>('#container-select')!.value) + 1;
  function text(id: string, value: string): void {
    const element = panel.querySelector(`#${id}`)!;
    if (element.textContent !== value) element.textContent = value;
  }
  function position(x: number, y: number): void {
    if (panel.hidden) return;
    anchorX = x; anchorY = y;
    const width = viewport.clientWidth, height = viewport.clientHeight;
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    const rightFits = x < width / 2;
    const left = Math.max(12, Math.min(width - pw - 12, width > 680 ? (rightFits ? x + 136 : x - pw - 136) : (width - pw) / 2));
    const top = Math.max(12, Math.min(height - ph - 12, width > 680 ? y - ph * .48 : y + 40));
    panel.style.left = `${left}px`; panel.style.top = `${top}px`;
    const endX = rightFits ? left : left + pw, endY = Math.max(top + 28, Math.min(y, top + ph - 28));
    const dx = endX - x, dy = endY - y;
    tether.hidden = width <= 680 || x < 0 || x > width || y < 0 || y > height;
    tether.style.left = `${x}px`; tether.style.top = `${y}px`;
    tether.style.width = `${Math.hypot(dx, dy)}px`; tether.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
  }
  function drawChart(): void {
    const width = chart.clientWidth, height = 112, scale = Math.min(devicePixelRatio, 2);
    chart.width = Math.round(width * scale); chart.height = height * scale;
    const ctx = chart.getContext('2d')!; ctx.scale(scale, scale);
    const left = 32, right = width - 14, x = (t: number): number => left + t / 2.6 * (right - left);
    const y = (value: string): number => value === 'CLOSED' ? 24 : 67;
    ctx.font = '11px system-ui'; ctx.fillStyle = '#5e707b';
    for (const [label, value] of [['닫힘',24],['열림',67]] as const) {
      ctx.fillText(label, 0, value + 4); ctx.strokeStyle = '#e2e7eb'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(left, value); ctx.lineTo(right, value); ctx.stroke();
    }
    for (const t of [0,1,2,2.6]) { ctx.fillText(`${t}s`, x(t) - (t === 2.6 ? 16 : 3), 99); }
    if (scenario === 'mismatch' && elapsed > 1.6) { ctx.fillStyle = '#f6e5c8'; ctx.fillRect(x(1.6), 12, x(elapsed)-x(1.6), 68); }
    for (const key of ['command','feedback'] as const) {
      ctx.strokeStyle = key === 'command' ? '#21877e' : '#c18030'; ctx.lineWidth = 2;
      ctx.setLineDash(key === 'feedback' ? [4,3] : []); ctx.beginPath();
      const breaks = [0,.6,.9,elapsed].filter(t => t <= elapsed).sort((a,b)=>a-b);
      let previousValue = contactorPlaybackFrame(scenario, 0)[key];
      ctx.moveTo(x(0), y(previousValue) + (key === 'feedback' ? 3 : -2));
      for (const t of breaks.slice(1)) {
        ctx.lineTo(x(t), y(previousValue) + (key === 'feedback' ? 3 : -2));
        const next = contactorPlaybackFrame(scenario, t + .00001)[key];
        if (next === 'UNKNOWN') break;
        ctx.lineTo(x(t), y(next) + (key === 'feedback' ? 3 : -2)); previousValue = next;
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.strokeStyle = '#b3bec7'; ctx.lineWidth = 1; ctx.setLineDash([2,3]);
    ctx.beginPath(); ctx.moveTo(x(elapsed), 9); ctx.lineTo(x(elapsed), 80); ctx.stroke(); ctx.setLineDash([]);
  }
  function render(focus = false): void {
    if (panel.hidden) return;
    const signal = contactorPlaybackFrame(scenario, elapsed);
    const labels = { ready: '정상 대기', pending: '개방 응답 확인 중', normal: '정상 개방', mismatch: '접점 상태 불일치', unknown: '통신 끊김' };
    const descriptions = { ready: '닫힌 접점에 개방 명령을 보내는 과정입니다.', pending: 'OPEN 명령 후 접점 피드백을 기다립니다.', normal: '명령에 따라 접점이 정상적으로 열렸습니다.', mismatch: '개방 명령에도 접점이 닫힌 상태를 유지합니다.', unknown: '피드백을 받지 못해 접점 상태를 판단할 수 없습니다.' };
    panel.dataset.diagnosis = signal.diagnosis;
    rackSelect.value = String(rackId); timeInput.value = String(elapsed);
    text('contactor-container', `ESS ${String(containerId()).padStart(2,'0')}`);
    text('contactor-result', labels[signal.diagnosis]); text('contactor-reason', descriptions[signal.diagnosis]);
    text('contactor-command', signal.command); text('contactor-feedback', signal.feedback);
    text('contactor-elapsed', `${elapsed.toFixed(1)}s`);
    text('contactor-evidence', signal.diagnosis === 'mismatch' ? 'OPEN 명령 후 1.0초를 초과해 CLOSED 피드백이 유지되는 시연입니다. 용착·구동부·피드백 회로 등 추가 확인이 필요하며 용착을 확정하지 않습니다.' : signal.diagnosis === 'unknown' ? '현재 피드백 데이터가 없습니다. 마지막 값을 정상 상태로 재사용하지 않으며 통신·수집 경로를 먼저 확인합니다.' : '명령과 피드백의 전환 시점을 비교합니다. 정상 예시에서는 개방 명령 후 0.3초에 OPEN 피드백을 받습니다.');
    playButton.textContent = running ? '일시정지' : elapsed >= 2.6 ? '다시 재생' : '재생';
    playButton.setAttribute('aria-label', running ? '시연 일시정지' : '시연 재생');
    panel.querySelector('#ct-stage-command')!.classList.toggle('ct-complete', elapsed >= .6);
    panel.querySelector('#ct-stage-feedback')!.classList.toggle('ct-complete', elapsed >= .9);
    panel.querySelector('#ct-stage-diagnosis')!.classList.toggle('ct-complete', signal.diagnosis === 'normal' || signal.diagnosis === 'mismatch' || signal.diagnosis === 'unknown');
    const issueButton = panel.querySelector<HTMLButtonElement>('#contactor-issue')!;
    issueButton.textContent = running && scenario === 'mismatch' ? '이슈 발생 중…' : '이슈 다시 발생';
    issueButton.disabled = running && scenario === 'mismatch';
    chart.setAttribute('aria-label', `${labels[signal.diagnosis]}. 명령 ${signal.command}, 피드백 ${signal.feedback}, 재생 시간 ${elapsed.toFixed(1)}초.`);
    drawChart();
    if (lastDiagnosis !== signal.diagnosis || focus) {
      lastDiagnosis = signal.diagnosis;
      document.dispatchEvent(new CustomEvent('contactorfocus', { detail: { rackId, diagnosis: signal.diagnosis, focus } }));
    }
    position(anchorX, anchorY);
  }
  function pause(): void { running = false; cancelAnimationFrame(frameId); }
  function tick(now: number): void {
    if (!running || panel.hidden) return;
    elapsed = Math.min(2.6, elapsed + Math.min((now - previousTime) / 1000, .1)); previousTime = now;
    if (elapsed >= 2.6) running = false;
    render(); if (running) frameId = requestAnimationFrame(tick);
  }
  function play(): void { running = true; previousTime = performance.now(); frameId = requestAnimationFrame(tick); render(); }
  function start(next: ContactorScenario, focus = false): void {
    pause(); scenario = next; elapsed = reducedMotion ? 2.6 : 0; lastDiagnosis = '';
    render(focus); if (!reducedMotion) play();
  }
  function close(): void {
    if (panel.hidden) return;
    pause(); panel.hidden = true; tether.hidden = true; viewport.classList.remove('contactor-mode');
    button.classList.remove('selected'); button.setAttribute('aria-expanded', 'false');
    document.dispatchEvent(new Event('contactorclose'));
  }
  button.addEventListener('click', () => {
    if (!panel.hidden) { close(); return; }
    document.dispatchEvent(new Event('diagnosticsclose'));
    panel.hidden = false; panel.scrollTop = 0; viewport.classList.add('contactor-mode');
    button.classList.add('selected'); button.setAttribute('aria-expanded', 'true');
    start('mismatch', true);
  });
  panel.querySelector('.ct-close')!.addEventListener('click', () => { close(); button.focus(); });
  panel.querySelector('#contactor-issue')!.addEventListener('click', () => start('mismatch'));
  panel.querySelector('#contactor-compare')!.addEventListener('click', () => start('normal'));
  panel.querySelector('#contactor-offline')!.addEventListener('click', () => start('offline'));
  playButton.addEventListener('click', () => { if (running) { pause(); render(); } else { if (elapsed >= 2.6) elapsed = 0; play(); } });
  timeInput.addEventListener('input', () => { pause(); elapsed = Number(timeInput.value); render(); });
  rackSelect.addEventListener('change', () => { rackId = Number(rackSelect.value); start(scenario, true); });
  document.addEventListener('modelready', () => { button.disabled = false; });
  document.addEventListener('containerchange', () => queueMicrotask(() => {
    if (!panel.hidden) { document.dispatchEvent(new Event('diagnosticsclose')); start(scenario, true); }
  }));
  document.addEventListener('contactorclose-request', close);
  document.addEventListener('rackfocus', event => { if (!panel.hidden) { rackId = (event as CustomEvent<number>).detail; start(scenario, true); } });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) { close(); button.focus(); } });
  for (const id of ['home','racks','panel','ebsc']) document.getElementById(id)!.addEventListener('click', close);
  new ResizeObserver(() => { if (!panel.hidden) { drawChart(); position(anchorX, anchorY); } }).observe(panel);
  return { position };
}
