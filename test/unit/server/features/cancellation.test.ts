import assert from 'node:assert/strict';
import { CancellationTokenSource } from 'vscode-languageserver/node';
import { untilCancelled } from '../../../../src/server/features/cancellation.ts';

describe('server/features/cancellation', () => {
  it('resolves when the promise settles', async () => {
    const source = new CancellationTokenSource();
    await untilCancelled(Promise.resolve(), source.token);
    assert.equal(source.token.isCancellationRequested, false);
  });

  it('resolves when the token is cancelled before the promise settles', async () => {
    const source = new CancellationTokenSource();
    const waiting = untilCancelled(new Promise<void>(() => undefined), source.token);
    source.cancel();
    await waiting;
    assert.equal(source.token.isCancellationRequested, true);
  });

  it('resolves at once for a token that is already cancelled', async () => {
    const source = new CancellationTokenSource();
    source.cancel();
    await untilCancelled(new Promise<void>(() => undefined), source.token);
  });

  it('never rejects when the promise rejects', async () => {
    const source = new CancellationTokenSource();
    await untilCancelled(Promise.reject(new Error('index failed')), source.token);
  });
});
