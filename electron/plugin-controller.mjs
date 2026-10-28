import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginStore } from '../core/plugin-store.mjs';
import { validNotePath } from '../core/vault.mjs';

export class PluginController {
  instances = new Map(); context = { notes: [], active: null }; vault = null;
  constructor({ directory, BrowserWindow, ipcMain, getVault, onStatus, onOpen }) {
    this.store = new PluginStore(directory); this.BrowserWindow = BrowserWindow;
    this.getVault = getVault; this.onStatus = onStatus; this.onOpen = onOpen;
    ipcMain.handle('notes-plugin:request', async (event, args) => {
      try {
        const entry = [...this.instances.values()].find(entry => entry.window.webContents === event.sender);
        if (!entry || event.senderFrame !== entry.window.webContents.mainFrame || event.senderFrame.url !== entry.url || this.getVault()?.id !== entry.vault.id || (entry.stopping && !['save-data', 'publish'].includes(args?.action))) throw new Error('종료되었거나 신뢰할 수 없는 플러그인입니다.');
        const { action, value } = args || {};
        let result;
        if (action === 'initialize') result = { program: entry.program, state: { ...this.context, data: await this.store.loadData(entry.vault.id, entry.id) } };
        else if (action === 'save-data') result = await this.store.saveData(entry.vault.id, entry.id, value);
        else if (action === 'create-note') {
          if (!validNotePath(value?.path) || typeof value.content !== 'string') throw new Error('올바른 Markdown 문서가 필요합니다.');
          result = await entry.vault.create(value.path, value.content);
          this.onOpen({ vaultId: entry.vault.id, path: result.path, created: true });
        } else if (action === 'open-note') {
          if (!validNotePath(value?.path) || !(await entry.vault.snapshot()).notes.some(note => note.path === value.path)) throw new Error('보관함 문서를 찾을 수 없습니다.');
          this.onOpen({ vaultId: entry.vault.id, path: value.path }); result = true;
        } else if (action === 'publish') {
          if (value?.phase === 'unloaded') entry.unloaded?.();
          if (Array.isArray(value?.commands)) entry.commands = value.commands.filter(command => typeof command.id === 'string' && command.id.startsWith(entry.id + ':') && typeof command.name === 'string').slice(0, 500);
          if (typeof value?.error === 'string') { entry.error = value.error; entry.phase = 'error'; entry.commands = []; entry.ready?.(); }
          if (value?.phase === 'loaded') { entry.phase = 'loaded'; entry.ready?.(); }
          this.publish();
        } else throw new Error(`지원하지 않는 플러그인 요청: ${action}`);
        return { ok: true, value: result ?? null };
      } catch (error) { return { ok: false, error: error.message }; }
    });
  }
  async status() {
    if (!this.vault) return { vaultId: null, entries: [] };
    const vault = this.vault, installed = await this.store.list(vault.id);
    if (vault !== this.vault) return { vaultId: vault.id, entries: [] };
    return { vaultId: vault.id, entries: installed.map(manifest => {
      const entry = this.instances.get(manifest.id);
      return { ...manifest, phase: entry?.phase || 'disabled', error: entry?.error || '', commands: entry?.phase === 'loaded' ? entry.commands : [] };
    }) };
  }
  publish() { this.status().then(value => this.onStatus(value)).catch(error => this.onStatus({ vaultId: this.vault?.id, entries: [], error: error.message })); }
  async activate(vault) {
    await this.close(); this.vault = vault; if (!vault) return;
    for (const plugin of await this.store.list(vault.id)) if (plugin.enabled) await this.start(plugin.id).catch(() => {});
    this.publish();
  }
  async import(folder) {
    const manifest = await this.store.import(folder);
    if (this.instances.has(manifest.id)) await this.disable(manifest.id);
    this.publish(); return manifest;
  }
  async start(id) {
    if (!this.vault || this.getVault()?.id !== this.vault.id) throw new Error('보관함이 변경되었습니다.');
    const previous = this.instances.get(id);
    if (previous?.phase === 'loaded') { previous.window.show(); return; }
    if (previous) await this.stop(id);
    const program = await this.store.program(id), vault = this.vault;
    if (!this.context.notes.length) this.context = { ...this.context, notes: (await vault.snapshot()).notes };
    if (this.getVault()?.id !== vault.id) throw new Error('보관함이 변경되었습니다.');
    const window = new this.BrowserWindow({ width: 520, height: 760, title: `${program.manifest.name} · Dynote`, webPreferences: { preload: path.join(path.dirname(fileURLToPath(import.meta.url)), 'plugin-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    window.setMenu(null); window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    const entry = { id, vault, program, window, url: `notes://plugin-${vault.id}-${id}/plugin.html`, commands: [], phase: 'loading', error: '', stopping: false };
    this.instances.set(id, entry);
    window.on('close', event => { if (!entry.stopping) { event.preventDefault(); window.hide(); } });
    window.on('closed', () => { if (this.instances.get(id) === entry) this.instances.delete(id); this.publish(); });
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('플러그인 시작 시간이 초과되었습니다.')), 20000);
      entry.ready = () => { clearTimeout(timer); resolve(); };
      window.webContents.once('render-process-gone', () => { entry.phase = 'error'; entry.error = '플러그인 실행 창이 종료되었습니다.'; entry.commands = []; entry.ready(); this.publish(); });
    });
    try {
      await window.loadURL(entry.url); await ready;
      if (entry.phase !== 'loaded') throw new Error(entry.error || '플러그인을 시작하지 못했습니다.');
    } catch (error) { entry.phase = 'error'; entry.error = error.message; entry.commands = []; entry.ready(); this.publish(); throw error; }
    this.publish();
  }
  async enable(id) { await this.start(id); await this.store.setEnabled(this.vault.id, id, true); this.publish(); }
  async disable(id) { if (!this.vault) return; await this.stop(id); await this.store.setEnabled(this.vault.id, id, false); this.publish(); }
  async stop(id) {
    const entry = this.instances.get(id); if (!entry) return;
    entry.stopping = true; entry.ready?.();
    if (!entry.window.isDestroyed()) {
      if (entry.phase === 'loaded') await new Promise(resolve => {
        const timer = setTimeout(resolve, 1500);
        entry.unloaded = () => { clearTimeout(timer); resolve(); };
        entry.window.webContents.send('notes-plugin:event', { type: 'unload' });
      });
      entry.window.destroy();
    }
    this.instances.delete(id);
  }
  show(id, settings = false) { const entry = this.instances.get(id); if (!entry || entry.phase !== 'loaded') throw new Error('플러그인을 먼저 켜 주세요.'); entry.window.show(); entry.window.focus(); if (settings) entry.window.webContents.send('notes-plugin:event', { type: 'settings' }); }
  execute(id, command) { const entry = this.instances.get(id); if (!entry || entry.phase !== 'loaded' || !entry.commands.some(item => item.id === command)) throw new Error('실행할 수 없는 플러그인 명령입니다.'); this.show(id); entry.window.webContents.send('notes-plugin:event', { type: 'command', id: command }); }
  update(context) {
    this.context = context;
    for (const entry of this.instances.values()) if (entry.phase === 'loaded' && !entry.stopping) entry.window.webContents.send('notes-plugin:event', { type: 'context', value: context });
  }
  async close() { for (const id of [...this.instances.keys()]) await this.stop(id); this.vault = null; this.context = { notes: [], active: null }; }
}
