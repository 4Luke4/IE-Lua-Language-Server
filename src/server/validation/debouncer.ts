/** The timer functions the debouncer needs; injected so tests can use fake timers. */
export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Runs at most one pending callback per key, `delay` ms after the last `schedule`. */
export class Debouncer<K> {
  private readonly pending = new Map<K, unknown>();
  private readonly timers: Timers;

  constructor(timers: Timers) {
    this.timers = timers;
  }

  schedule(key: K, delay: number, callback: () => void): void {
    this.cancel(key);
    const handle = this.timers.setTimeout(() => {
      this.pending.delete(key);
      callback();
    }, delay);
    this.pending.set(key, handle);
  }

  cancel(key: K): void {
    if (this.pending.has(key)) {
      this.timers.clearTimeout(this.pending.get(key));
      this.pending.delete(key);
    }
  }

  isPending(key: K): boolean {
    return this.pending.has(key);
  }

  dispose(): void {
    for (const key of [...this.pending.keys()]) {
      this.cancel(key);
    }
  }
}
