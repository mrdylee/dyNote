import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PluginController } from '../electron/plugin-controller.mjs';
import { Vault } from '../core/vault.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dynote-plugin-controller-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'program'), vaultRoot = path.join(root, 'vault');
  await mkdir(folder); await mkdir(vaultRoot);
  await writeFile(path.join(folder, 'manifest.json'), '{"id":"sample","name":"Sample","version":"1"}');
  await writeFile(path.join(folder, 'main.js'), 'module.exports = class {};');
  const vault = await Vault.open(vaultRoot, path.join(root, 'recovery'));
  let current = vault; const handlers = new Map(), opened = [];
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.webContents = new EventEmitter(); this.destroyed = false; this.unloaded = false;
      this.webContents.mainFrame = { url: 'notes://app/plugin.html' };
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = (_channel, value) => { if (value.type === 'unload') { this.unloaded = true; this.request('publish', { phase: 'unloaded' }); } };
    }
    request(action, value, frame = this.webContents.mainFrame) { return handlers.get('notes-plugin:request')({ sender: this.webContents, senderFrame: frame }, { action, value }); }
    async loadURL(url) { this.webContents.mainFrame.url = url; await this.request('publish', { commands: [{ id: 'sample:run', name: 'Sample: Run' }], phase: 'loaded' }); }
    setMenu() {} show() {} focus() {} hide() {} isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const controller = new PluginController({ directory: path.join(root, 'plugins'), BrowserWindow: Window, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, getVault: () => current, onStatus: () => {}, onOpen: value => opened.push(value) });
  await controller.activate(vault); await controller.import(folder); await controller.enable('sample');
  return { controller, vault, vaultRoot, opened, handlers, entry: controller.instances.get('sample'), changeVault: value => { current = value; } };
}

test('owned plugin bridge creates a real note but rejects foreign frames, traversal and stale vaults', async t => {
  const f = await fixture(t), window = f.entry.window;
  assert.equal(window.options.webPreferences.sandbox, true); assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal((await window.request('create-note', { path: 'Created.md', content: 'original plugin' })).ok, true);
  assert.equal(await readFile(path.join(f.vaultRoot, 'Created.md'), 'utf8'), 'original plugin');
  assert.equal(f.opened[0].path, 'Created.md');
  assert.equal((await window.request('create-note', { path: '../Outside.md', content: 'bad' })).ok, false);
  assert.equal((await window.request('create-note', { path: 'Frame.md', content: 'bad' }, { url: 'notes://app/plugin.html' })).ok, false);
  const foreign = await f.handlers.get('notes-plugin:request')({ sender: {}, senderFrame: window.webContents.mainFrame }, { action: 'initialize' });
  assert.equal(foreign.ok, false);
  f.changeVault({ id: 'other-vault' });
  assert.equal((await window.request('create-note', { path: 'Stale.md', content: 'bad' })).ok, false);
  f.changeVault(f.vault); await f.controller.close();
});

test('disable requests original lifecycle unload and removes active commands', async t => {
  const f = await fixture(t);
  assert.equal((await f.controller.status()).entries[0].commands[0].id, 'sample:run');
  await f.controller.disable('sample');
  assert.equal(f.entry.window.unloaded, true); assert.equal(f.entry.window.destroyed, true);
  const state = (await f.controller.status()).entries[0];
  assert.equal(state.enabled, false); assert.deepEqual(state.commands, []);
});

test('a vault without enabled plugins does not add another full-vault startup read', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'dynote-plugin-lazy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = { id: '0123456789abcdef', snapshot: () => { throw new Error('Unexpected eager snapshot'); } };
  const controller = new PluginController({ directory: root, BrowserWindow: null, ipcMain: { handle() {} }, getVault: () => vault, onStatus() {}, onOpen() {} });
  await controller.activate(vault);
  assert.deepEqual((await controller.status()).entries, []);
});
