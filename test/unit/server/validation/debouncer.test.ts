import assert from 'node:assert/strict';
import { Debouncer, type Timers } from '../../../../src/server/validation/debouncer.ts';

/** Deterministic manual clock: nothing runs until `advance` is called. */
class FakeTimers implements Timers {
  now = 0;
  private nextId = 1;
  private readonly queue = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, ms: number): number {
    const id = this.nextId++;
    this.queue.set(id, { at: this.now + ms, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.queue.delete(handle as number);
  }

  advance(ms: number): void {
    this.now += ms;
    for (const [id, timer] of [...this.queue].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at <= this.now) {
        this.queue.delete(id);
        timer.callback();
      }
    }
  }
}

describe('server/validation/debouncer', () => {
  it('runs the callback once, delay ms after the last schedule', () => {
    const timers = new FakeTimers();
    const debouncer = new Debouncer<string>(timers);
    const calls: number[] = [];
    debouncer.schedule('a', 300, () => calls.push(timers.now));
    timers.advance(200);
    debouncer.schedule('a', 300, () => calls.push(timers.now));
    timers.advance(299);
    assert.deepEqual(calls, []);
    timers.advance(1);
    assert.deepEqual(calls, [500]);
    assert.equal(debouncer.isPending('a'), false);
  });

  it('keeps keys independent', () => {
    const timers = new FakeTimers();
    const debouncer = new Debouncer<string>(timers);
    const calls: string[] = [];
    debouncer.schedule('a', 100, () => calls.push('a'));
    debouncer.schedule('b', 50, () => calls.push('b'));
    timers.advance(100);
    assert.deepEqual(calls, ['b', 'a']);
  });

  it('runs a zero-delay callback on the next timer tick, not synchronously', () => {
    const timers = new FakeTimers();
    const debouncer = new Debouncer<string>(timers);
    let ran = false;
    debouncer.schedule('a', 0, () => (ran = true));
    assert.equal(ran, false);
    timers.advance(0);
    assert.equal(ran, true);
  });

  it('cancel and dispose drop pending callbacks', () => {
    const timers = new FakeTimers();
    const debouncer = new Debouncer<string>(timers);
    let count = 0;
    debouncer.schedule('a', 10, () => count++);
    debouncer.schedule('b', 10, () => count++);
    debouncer.cancel('a');
    debouncer.dispose();
    timers.advance(100);
    assert.equal(count, 0);
  });
});
