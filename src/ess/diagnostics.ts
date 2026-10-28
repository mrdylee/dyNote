import { formatRackLabel, SampleTelemetryProvider, type RackTelemetry, type EquipmentTelemetry } from './telemetry';

export async function setupDiagnostics(): Promise<void> {
  const provider = new SampleTelemetryProvider();
  let racks = await provider.read();
  let equipment = await provider.readEquipment();
  const viewport = document.querySelector<HTMLElement>('#viewport')!;
  const panel = document.querySelector<HTMLElement>('#telemetry')!;
  panel.hidden = true;
  const toggle = document.createElement('button');
  toggle.id = 'all-info'; toggle.textContent = '전체 정보';
  toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'telemetry');
  document.querySelector('footer .group')!.append(toggle);
  const popup = document.createElement('aside');
  popup.id = 'diagnostic-popover'; popup.hidden = true;
  popup.setAttribute('aria-label', '장치 진단 정보');
  viewport.append(popup);
  let active: HTMLElement | undefined;
  let pinned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function rackDetails(rack: RackTelemetry): string {
    return `<div class="metric-grid"><span>온도<strong>${rack.temperatureC.toFixed(1)} <small>°C</small></strong></span><span>전압<strong>${rack.voltageV.toFixed(1)} <small>V</small></strong></span><span>전류<strong>${rack.currentA.toFixed(1)} <small>A</small></strong></span><span>SOC<strong>${rack.socPercent}<small>%</small></strong></span><span>SOH<strong>${rack.sohPercent.toFixed(1)}<small>%</small></strong></span><span>STATE<strong class="state-value">${rack.state}</strong></span></div><div class="diagnostic"><code>${rack.diagnosticCode}</code>${rack.diagnosticMessage}</div>`;
  }
  function equipmentDetails(item: EquipmentTelemetry): string {
    return `<div class="metric-grid"><span>통신<strong class="state-value">${item.communication}</strong></span><span>STATE<strong class="state-value">${item.mode}</strong></span>${item.dsState ? `<span>DS 상태<strong>${item.dsState === 'CLOSED' ? 'CLOSE' : 'OPEN'}</strong></span>` : '<span>LAN<strong>4 <small>PORTS</small></strong></span>'}</div><div class="diagnostic"><code>${item.diagnosticCode}</code>${item.diagnosticMessage}</div>`;
  }
  function renderCards(): void {
  document.querySelector('#rack-cards')!.innerHTML = racks.map(rack => `<button class="rack-card ${rack.status}" data-rack="${rack.rackId}"><span class="rack-title"><b>${formatRackLabel(rack.rackId)}</b><i>${rack.status === 'warning' ? '고온 경고' : '정상'}</i></span>${rackDetails(rack)}</button>`).join('');
  document.querySelector('#equipment-cards')!.innerHTML = equipment.map(item => `<button class="equipment-card" data-equipment="${item.id}"><b>${item.id}</b>${equipmentDetails(item)}</button>`).join('');
  }
  renderCards();
  function dismiss(): void {
    clearTimeout(timer); popup.hidden = true; active = undefined; pinned = false;
    document.querySelectorAll('.rack-marker.selected').forEach(item => item.classList.remove('selected'));
  }
  function position(): void {
    if (popup.hidden || !active) return;
    const bounds = viewport.getBoundingClientRect(); const anchor = active.getBoundingClientRect();
    const availableWidth = panel.hidden ? bounds.width : Math.max(300, panel.offsetLeft - 12);
    const x = anchor.left - bounds.left + anchor.width / 2;
    const y = anchor.top - bounds.top;
    const left = Math.max(8, Math.min(x + 20, availableWidth - popup.offsetWidth - 8));
    const top = Math.max(8, Math.min(y + anchor.height + 14, bounds.height - popup.offsetHeight - 8));
    popup.style.left = `${left}px`; popup.style.top = `${top}px`;
  }
  function show(target: HTMLElement, pin: boolean): void {
    if (viewport.classList.contains('contactor-mode')) {
      if (pin && target.dataset.rack) document.dispatchEvent(new CustomEvent('rackfocus', { detail: Number(target.dataset.rack) }));
      return;
    }
    clearTimeout(timer);
    if (pinned && !pin) return;
    const rack = racks.find(item => String(item.rackId) === target.dataset.rack);
    const item = equipment.find(item => item.id === target.dataset.equipment);
    if (!rack && !item) return;
    active = document.querySelector<HTMLElement>(rack ? `.rack-marker[data-rack="${rack.rackId}"]` : `.equipment-marker[data-equipment="${item!.id}"]`) ?? target;
    pinned = pin;
    if (pin && rack) document.dispatchEvent(new CustomEvent('rackfocus', { detail: rack.rackId }));
    popup.classList.toggle('warning', rack?.status === 'warning');
    popup.innerHTML = `<div class="popover-heading"><div><span class="eyebrow">LIVE DIAGNOSTICS</span><h2>${rack ? formatRackLabel(rack.rackId) : item!.id}<span class="health">${rack?.status === 'warning' ? '고온 경고' : '정상'}</span></h2></div><button class="dismiss" aria-label="진단 말풍선 닫기">×</button></div><p class="connection">SIMULATION · 장비 미연결 · 예시 데이터</p>${rack ? rackDetails(rack) : equipmentDetails(item!)}<div class="popover-footer">${pin ? '고정됨 · 다른 장치를 클릭하면 전환' : '클릭하면 정보 고정'}</div>`;
    popup.querySelector('.dismiss')!.addEventListener('click', dismiss);
    document.querySelectorAll('.rack-marker').forEach(marker => marker.classList.toggle('selected', marker === active));
    popup.hidden = false; position();
  }
  const selector = '.rack-marker,.rack-card,.equipment-card';
  function scheduleHide(): void { clearTimeout(timer); if (!pinned) timer = setTimeout(dismiss, 180); }
  viewport.addEventListener('pointerover', event => { const target = (event.target as Element).closest<HTMLElement>(selector); if (target && !target.contains(event.relatedTarget as Node)) show(target, false); });
  viewport.addEventListener('pointerout', event => { const target = (event.target as Element).closest<HTMLElement>(selector); if (target && !target.contains(event.relatedTarget as Node)) scheduleHide(); });
  viewport.addEventListener('focusin', event => { const target = (event.target as Element).closest<HTMLElement>(selector); if (target) show(target, false); });
  viewport.addEventListener('focusout', scheduleHide);
  viewport.addEventListener('click', event => { const target = (event.target as Element).closest<HTMLElement>(selector); if (target) { event.stopImmediatePropagation(); show(target, true); } }, true);
  popup.addEventListener('pointerenter', () => clearTimeout(timer));
  popup.addEventListener('pointerleave', scheduleHide);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') dismiss(); });
  document.querySelector('#home')!.addEventListener('click', dismiss);
  let selectionVersion = 0;
  document.addEventListener('containerchange', async () => {
    dismiss();
    const version = ++selectionVersion;
    const containerId = Number(document.querySelector<HTMLSelectElement>('#container-select')!.value) + 1;
    panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); toggle.classList.add('selected');
    document.querySelector('#rack-cards')!.textContent = '데이터 불러오는 중…';
    document.querySelector('#equipment-cards')!.replaceChildren();
    const [nextRacks, nextEquipment] = await Promise.all([provider.read(containerId), provider.readEquipment(containerId)]);
    if (version !== selectionVersion) return;
    racks = nextRacks; equipment = nextEquipment;
    renderCards(); markWarnings();
  });
  toggle.addEventListener('click', () => { document.dispatchEvent(new Event('contactorclose-request')); panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); toggle.classList.toggle('selected', !panel.hidden); position(); });
  document.addEventListener('diagnosticsclose', () => { dismiss(); panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.classList.remove('selected'); });
  const observer = new MutationObserver(position);
  observer.observe(document.querySelector('#rack-markers')!, { subtree: true, attributes: true, attributeFilter: ['style'] });
  new ResizeObserver(position).observe(viewport);
  const markWarnings = (): void => { racks.forEach(rack => document.querySelector(`.rack-marker[data-rack="${rack.rackId}"]`)?.classList.toggle('warning', rack.status === 'warning')); };
  new MutationObserver(markWarnings).observe(document.querySelector('#rack-markers')!, { childList: true });
  markWarnings();
  document.querySelector('.hint')!.textContent = '장치 라벨에 마우스 올리기 · 클릭으로 정보 고정 · 드래그 회전';
}
