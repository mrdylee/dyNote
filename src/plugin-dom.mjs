// Obsidian's public DOM convenience methods, independently implemented for plugin windows.
export function installPluginDom(window) {
  const { document, Element, Node, Array: WindowArray } = window;
  const method = (prototype, name, value) => {
    if (!Object.hasOwn(prototype, name)) Object.defineProperty(prototype, name, { value, configurable: true, writable: true });
  };
  const create = function(tag, options = {}, callback) {
    if (typeof options === 'string') options = { cls: options };
    const el = document.createElement(tag);
    if (options.cls) el.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
    if (options.text != null) el.textContent = String(options.text);
    if (options.attr) for (const [key, value] of Object.entries(options.attr)) el.setAttribute(key, String(value));
    if (options.type) el.setAttribute('type', options.type);
    if (options.href) el.setAttribute('href', options.href);
    if (options.title) el.title = options.title;
    if (options.parent) options.parent.appendChild(el); else this.appendChild(el);
    callback?.(el); return el;
  };
  for (const prototype of [Element.prototype, window.DocumentFragment.prototype]) {
    method(prototype, 'createEl', create);
    method(prototype, 'createDiv', function(options, callback) { return create.call(this, 'div', options, callback); });
    method(prototype, 'createSpan', function(options, callback) { return create.call(this, 'span', options, callback); });
    method(prototype, 'empty', function() { this.replaceChildren(); });
  }
  for (const [name, fn] of Object.entries({
    addClass(...names) { this.classList.add(...names.flatMap(n => n.split(' ')).filter(Boolean)); },
    removeClass(...names) { this.classList.remove(...names); },
    toggleClass(name, value) { this.classList.toggle(name, value); },
    hasClass(name) { return this.classList.contains(name); },
    setText(text) { this.textContent = String(text); },
    setAttr(name, value) { if (value == null) this.removeAttribute(name); else this.setAttribute(name, String(value)); },
    setAttrs(attrs) { for (const [name, value] of Object.entries(attrs)) this.setAttr(name, value); },
    setChildrenInPlace(children) { this.replaceChildren(...children); },
    setCssProps(props) { for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value); },
    find(selector) { return this.querySelector(selector); },
    findAll(selector) { return [...this.querySelectorAll(selector)]; },
    show() { this.hidden = false; this.style.display = ''; },
    hide() { this.hidden = true; },
  })) method(Element.prototype, name, fn);
  method(Node.prototype, 'appendText', function(text) { this.appendChild(document.createTextNode(text)); });
  method(WindowArray.prototype, 'first', function() { return this[0]; });
  method(WindowArray.prototype, 'last', function() { return this.at(-1); });
  method(WindowArray.prototype, 'contains', WindowArray.prototype.includes);
  method(WindowArray.prototype, 'remove', function(value) { const index = this.indexOf(value); if (index !== -1) this.splice(index, 1); });
  method(window.String.prototype, 'contains', window.String.prototype.includes);
  window.activeDocument = document; window.activeWindow = window;
  window.createEl = (tag, options, callback) => create.call(document.createDocumentFragment(), tag, options, callback);
  window.createDiv = (options, callback) => window.createEl('div', options, callback);
  window.createSpan = (options, callback) => window.createEl('span', options, callback);
}
