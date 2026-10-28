import moment from 'moment/moment.js';
import 'moment/locale/ko.js';
import 'moment/locale/en-gb.js';
import { installPluginDom } from './plugin-dom.mjs';

export function createPluginRuntime(window, program, bridge, initial) {
  installPluginDom(window);
  const document = window.document, commands = new Map(), viewFactories = new Map(), leaves = [], settings = [];
  let state = initial, plugin, data = initial.data, loaded = false;
  const reportError = error => bridge.publish({ error: error.message || String(error) });
  const safe = callback => (...args) => { try { Promise.resolve(callback(...args)).catch(reportError); } catch (error) { reportError(error); } };
  class Events {
    listeners = new Map();
    on(name, callback, context) { const ref = { bus: this, name, callback, context }; const entries = this.listeners.get(name) || new Set(); entries.add(ref); this.listeners.set(name, entries); return ref; }
    off(name, callback) { for (const ref of this.listeners.get(name) || []) if (ref.callback === callback) this.offref(ref); }
    offref(ref) { this.listeners.get(ref.name)?.delete(ref); }
    trigger(name, ...args) { for (const ref of [...(this.listeners.get(name) || [])]) safe(ref.callback.bind(ref.context))(...args); }
  }
  class Component {
    cleanups = []; children = [];
    register(callback) { this.cleanups.push(callback); }
    registerEvent(ref) { this.register(() => ref.bus.offref(ref)); }
    registerDomEvent(el, name, callback, options) { el.addEventListener(name, callback, options); this.register(() => el.removeEventListener(name, callback, options)); }
    registerInterval(id) { this.register(() => window.clearInterval(id)); return id; }
    addChild(child) { this.children.push(child); return child; }
    async load() { await this.onload?.(); }
    async unload() { await this.onunload?.(); for (const child of this.children.splice(0)) await child.unload(); for (const dispose of this.cleanups.splice(0).reverse()) dispose(); }
  }
  class TAbstractFile { constructor(path) { this.path = path; this.name = path.split('/').at(-1); } }
  class TFile extends TAbstractFile { constructor(note) { super(note.path); this.extension = this.name.split('.').at(-1); this.basename = this.name.slice(0, -(this.extension.length + 1)); this.content = note.content; this.stat = { size: note.metadata?.size ?? note.content.length, mtime: note.metadata?.mtime || 0, ctime: note.metadata?.ctime || 0 }; } }
  class TFolder extends TAbstractFile { children = []; }
  let files = new Map(), folders = new Map();
  const normalizePath = value => String(value).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
  const rebuild = notes => {
    const next = new Map(), root = new TFolder('/'); folders = new Map([['', root], ['/', root]]);
    for (const note of notes) {
      const file = files.get(note.path) || new TFile(note); Object.assign(file, new TFile(note)); next.set(file.path, file);
      let parent = root, prefix = '';
      for (const part of file.path.split('/').slice(0, -1)) {
        prefix += (prefix ? '/' : '') + part;
        if (!folders.has(prefix)) { const folder = new TFolder(prefix); folder.parent = parent; parent.children.push(folder); folders.set(prefix, folder); }
        parent = folders.get(prefix);
      }
      file.parent = parent; parent.children.push(file);
    }
    files = next;
  };
  rebuild(state.notes);
  class FileView extends Component { constructor() { super(); this.file = files.get(state.active) || null; } getViewType() { return 'markdown'; } }
  class ItemView extends Component {
    constructor(leaf) { super(); this.leaf = leaf; this.app = app; this.containerEl = document.createElement('section'); this.containerEl.className = 'plugin-view'; this.containerEl.createDiv({ cls: 'view-header' }); this.contentEl = this.containerEl.createDiv({ cls: 'view-content' }); }
    addAction(icon, title, callback) { const button = this.containerEl.firstChild.createEl('button', { text: title }); button.addEventListener('click', safe(callback)); return button; }
  }
  const vault = Object.assign(new Events(), {
    getFiles: () => [...files.values()], getMarkdownFiles: () => [...files.values()],
    getRoot: () => folders.get(''),
    getAbstractFileByPath: path => files.get(normalizePath(path)) || folders.get(normalizePath(path)) || null,
    getFileByPath: path => files.get(normalizePath(path)) || null,
    read: async file => { if (!file || !files.has(file.path)) throw new Error('파일을 찾을 수 없습니다.'); return files.get(file.path).content; },
    getConfig: name => name === 'defaultViewMode' ? 'source' : undefined,
    createFolder: async path => { const key = normalizePath(path); if (!key || key.split('/').some(p => p.startsWith('.'))) throw new Error('지원하지 않는 폴더 경로입니다.'); const folder = new TFolder(key); folders.set(key, folder); return folder; },
    create: async (path, content) => { const note = await bridge.request('create-note', { path, content }); const file = new TFile(note); files.set(path, file); vault.trigger('create', file); return file; },
  });
  vault.cachedRead = vault.read;
  const noteLeaf = { view: new FileView(), openFile: async file => { await bridge.request('open-note', { path: file.path }); noteLeaf.view.file = file; workspace.trigger('file-open', file); }, getViewState: () => ({ type: 'markdown', state: { file: state.active } }) };
  class Leaf {
    async setViewState(value) {
      if (!viewFactories.has(value.type)) throw new Error(`지원하지 않는 플러그인 보기: ${value.type}`);
      await this.detach(); this.type = value.type; this.view = viewFactories.get(value.type)(this); leaves.push(this);
      document.querySelector('#views').appendChild(this.view.containerEl); await this.view.onload?.(); await this.view.onOpen?.();
    }
    async detach() { const index = leaves.indexOf(this); if (index >= 0) leaves.splice(index, 1); if (this.view) { await this.view.onClose?.(); await this.view.unload(); this.view.containerEl.remove(); this.view = null; } }
  }
  const newLeaf = () => new Leaf();
  const workspace = Object.assign(new Events(), {
    layoutReady: true, activeLeaf: noteLeaf,
    getActiveFile: () => files.get(state.active) || null,
    getLeaf: () => noteLeaf, getUnpinnedLeaf: () => noteLeaf, splitActiveLeaf: () => noteLeaf,
    getLeftLeaf: newLeaf, getRightLeaf: newLeaf,
    getLeavesOfType: type => window.Array.from(leaves.filter(leaf => leaf.type === type)),
    detachLeavesOfType: async type => { for (const leaf of [...leaves]) if (leaf.type === type) await leaf.detach(); },
    revealLeaf: async leaf => { if (leaf?.view) leaf.view.containerEl.hidden = false; },
    ensureSideLeaf: async type => { const existing = leaves.find(leaf => leaf.type === type); if (existing) return existing; const leaf = newLeaf(); await leaf.setViewState({ type }); return leaf; },
    onLayoutReady: callback => callback(), registerHoverLinkSource: () => {},
  });
  const metadataCache = Object.assign(new Events(), {
    getFileCache: file => { const note = state.notes.find(note => note.path === file?.path); return note?.cache || { frontmatter: {}, tags: [], listItems: [] }; },
    getFirstLinkpathDest: path => files.get(path) || files.get(`${path}.md`) || null,
  });
  const daily = { enabled: true, instance: { options: state.dailyOptions || {} } };
  const app = { vault, workspace, metadataCache, isMobile: false, plugins: { getPlugin: id => id === program.manifest.id ? plugin : null }, internalPlugins: { plugins: { 'daily-notes': daily }, getPluginById: id => id === 'daily-notes' ? daily : null, getEnabledPluginById: () => null } };
  class Plugin extends Component {
    constructor(appValue, manifest) { super(); this.app = appValue; this.manifest = manifest; }
    loadData() { return Promise.resolve(data); }
    async saveData(value) { await bridge.request('save-data', value); data = value; }
    registerView(type, factory) { viewFactories.set(type, factory); this.register(() => viewFactories.delete(type)); }
    registerHoverLinkSource() {}
    addCommand(command) { const id = `${this.manifest.id}:${command.id}`; commands.set(id, { ...command, id, name: `${this.manifest.name}: ${command.name}` }); this.register(() => commands.delete(id)); publish(); return command; }
    addSettingTab(tab) { settings.push(tab); this.register(() => settings.splice(settings.indexOf(tab), 1)); }
  }
  class PluginSettingTab { constructor(appValue, pluginValue) { this.app = appValue; this.plugin = pluginValue; this.containerEl = document.createElement('section'); } }
  class Setting {
    constructor(container) { this.settingEl = container.createDiv({ cls: 'setting-item' }); this.infoEl = this.settingEl.createDiv(); this.nameEl = this.infoEl.createDiv({ cls: 'setting-item-name' }); this.descEl = this.infoEl.createDiv({ cls: 'setting-item-description' }); this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' }); }
    setName(text) { this.nameEl.setText(text); return this; }
    setDesc(value) { this.descEl.replaceChildren(); if (value instanceof window.Node) this.descEl.appendChild(value); else this.descEl.setText(value); return this; }
    setHeading() { this.settingEl.classList.add('setting-heading'); return this; }
    add(kind, callback) {
      const el = this.controlEl.createEl(kind === 'textarea' ? 'textarea' : kind === 'select' ? 'select' : kind === 'button' ? 'button' : 'input');
      if (kind === 'toggle') el.type = 'checkbox';
      const component = { inputEl: el, toggleEl: el, selectEl: el, buttonEl: el,
        setValue(value) { if (kind === 'toggle') el.checked = !!value; else el.value = String(value); return this; },
        getValue() { return kind === 'toggle' ? el.checked : el.value; },
        setPlaceholder(value) { el.placeholder = value; return this; },
        setDisabled(value) { el.disabled = value; return this; },
        addOption(value, text) { el.createEl('option', { text, attr: { value } }); return this; },
        addOptions(values) { for (const [value, text] of Object.entries(values)) this.addOption(value, text); return this; },
        onChange(callback) { el.addEventListener(kind === 'toggle' || kind === 'select' ? 'change' : 'input', safe(() => callback(this.getValue()))); return this; },
        setButtonText(text) { el.textContent = text; return this; }, setCta() { return this; }, setIcon(icon) { el.setAttribute('aria-label', icon); return this; },
        onClick(callback) { el.addEventListener('click', safe(callback)); return this; },
      };
      callback(component); return this;
    }
    addText(cb) { return this.add('text', cb); } addTextArea(cb) { return this.add('textarea', cb); } addToggle(cb) { return this.add('toggle', cb); } addDropdown(cb) { return this.add('select', cb); } addButton(cb) { return this.add('button', cb); }
  }
  class Notice { constructor(text) { const el = document.querySelector('#notices').createDiv({ text }); window.setTimeout(() => el.remove(), 6000); } }
  class Modal {
    constructor(appValue) { this.app = appValue; this.modalEl = document.createElement('section'); this.modalEl.className = 'modal'; this.modalEl.setAttribute('role', 'dialog'); this.titleEl = this.modalEl.createEl('h2'); this.contentEl = this.modalEl.createDiv(); this.modalEl.createEl('button', { text: '닫기' }).onclick = () => this.close(); }
    open() { document.body.appendChild(this.modalEl); this.onOpen?.(); } close() { this.onClose?.(); this.modalEl.remove(); }
    setTitle(text) { this.titleEl.setText(text); return this; }
  }
  class Menu {
    constructor() { this.el = document.createElement('div'); this.el.className = 'plugin-menu'; }
    addItem(callback) { const el = this.el.createEl('button'); const item = { setSection() { return this; }, setTitle(text) { el.textContent = text; return this; }, setIcon() { return this; }, setDisabled(value) { el.disabled = value; return this; }, onClick: callback => { el.onclick = safe(event => { this.el.remove(); callback(event); }); return item; } }; callback(item); return this; }
    addSeparator() { this.el.createEl('hr'); return this; }
    showAtPosition(position) { document.body.appendChild(this.el); this.el.style.left = `${position.x}px`; this.el.style.top = `${position.y}px`; }
    showAtMouseEvent(event) { this.showAtPosition({ x: event.clientX, y: event.clientY }); }
  }
  class Vault { static recurseChildren(folder, callback) { for (const child of folder.children || []) { callback(child); if (child instanceof TFolder) Vault.recurseChildren(child, callback); } } }
  const obsidian = { Plugin, Component, ItemView, FileView, TFile, TFolder, TAbstractFile, Vault, PluginSettingTab, Setting, Notice, Modal, Menu, normalizePath,
    Keymap: { isModEvent: event => event.metaKey || event.ctrlKey }, addIcon: () => {}, setIcon: (el, icon) => { el.setAttribute('data-icon', icon); }, setTooltip: (el, text) => { el.title = text; },
    parseFrontMatterTags: data => typeof data.tags === 'string' ? data.tags.split(/[,\s]+/).filter(Boolean).map(tag => `#${tag.replace(/^#/, '')}`) : Array.isArray(data.tags) ? data.tags.map(tag => `#${String(tag).replace(/^#/, '')}`) : [],
  };
  function publish() { bridge.publish({ commands: [...commands.values()].map(({ id, name }) => ({ id, name })) }); }
  const runtime = {
    get plugin() { return plugin; },
    commands: () => [...commands.values()],
    async load() {
      window.app = app; window.moment = moment;
      const module = { exports: {} };
      const require = name => { if (name === 'obsidian') return obsidian; if (name === 'moment') return moment; throw new Error(`지원하지 않는 플러그인 모듈: ${name}`); };
      const style = document.createElement('style'); style.textContent = program.css; document.head.appendChild(style);
      window.Function('require', 'module', 'exports', `${program.source}\n//# sourceURL=plugin-${program.manifest.id}.js`)(require, module, module.exports);
      const Constructor = module.exports.default || module.exports;
      if (typeof Constructor !== 'function' || !(Constructor.prototype instanceof Plugin)) throw new Error('Obsidian Plugin을 내보내는 프로그램이 필요합니다.');
      plugin = new Constructor(app, program.manifest); await plugin.load(); loaded = true;
      await plugin.onUserEnable?.(); publish();
      if (state.active) workspace.trigger('file-open', files.get(state.active) || null);
    },
    async execute(id) { const command = commands.get(id); if (!command) throw new Error('플러그인 명령을 찾을 수 없습니다.'); if (command.callback) await command.callback(); else if (command.checkCallback) await command.checkCallback(false); else throw new Error('지원하지 않는 편집기 명령입니다.'); },
    update(next) {
      const previous = new Map(state.notes.map(note => [note.path, note.content])), oldFiles = new Map(files), oldActive = state.active;
      state = next; rebuild(next.notes); daily.instance.options = state.dailyOptions || {};
      noteLeaf.view.file = files.get(state.active) || null;
      for (const [path, file] of files) if (!previous.has(path)) vault.trigger('create', file); else if (previous.get(path) !== file.content) { vault.trigger('modify', file); workspace.trigger('quick-preview', file, file.content); }
      for (const [path, file] of oldFiles) if (!files.has(path)) vault.trigger('delete', file);
      if (oldActive !== state.active) workspace.trigger('file-open', files.get(state.active) || null);
    },
    showSettings() { const container = document.querySelector('#settings'); container.replaceChildren(); for (const tab of settings) { container.appendChild(tab.containerEl); tab.display(); } container.hidden = false; },
    async unload() { for (const leaf of [...leaves]) await leaf.detach(); if (plugin) await plugin.unload(); loaded = false; commands.clear(); document.querySelector('#settings').replaceChildren(); publish(); },
    get loaded() { return loaded; },
  };
  return runtime;
}
