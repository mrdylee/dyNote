// An empty root list reserves the whole workspace for operations such as switching vaults.
export class VaultOperations {
  #running = new Set();

  get active() { return this.#running.size > 0; }
  get blocksClose() { return [...this.#running].some(operation => operation.blocksClose); }

  begin(roots, exclusive = false, blocksClose = exclusive) {
    for (const current of this.#running) {
      if ((exclusive || current.exclusive) && (!roots.length || !current.roots.length || roots.some(root => current.roots.includes(root))))
        throw new Error("다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.");
    }
    const operation = { roots, exclusive, blocksClose };
    this.#running.add(operation);
    return () => this.#running.delete(operation);
  }
}
