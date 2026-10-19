export class SaveQueue {
  #drafts = new Map();
  #running = null;

  constructor(save, onSaved = () => {}) {
    this.save = save;
    this.onSaved = onSaved;
  }

  get dirty() { return this.#drafts.size > 0; }
  get(path) { return this.#drafts.get(path); }
  set(note) {
    const previous = this.#drafts.get(note.path);
    this.#drafts.set(note.path, { ...note, revision: previous?.revision ?? note.revision });
  }

  flush() {
    if (this.#running) return this.#running;
    this.#running = this.#drain().finally(() => { this.#running = null; });
    return this.#running;
  }

  async #drain() {
    while (this.#drafts.size) {
      const [path, draft] = this.#drafts.entries().next().value;
      const saved = await this.save(path, draft.content, draft.revision);
      const current = this.#drafts.get(path);
      if (current === draft) this.#drafts.delete(path);
      else this.#drafts.set(path, { ...current, revision: saved.revision });
      this.onSaved(saved);
    }
  }
}
