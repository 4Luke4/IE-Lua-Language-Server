import type { CancellationToken } from 'vscode-languageserver/node';

/**
 * Resolves when `promise` settles or `token` is cancelled, whichever comes
 * first. Never rejects: callers check `token.isCancellationRequested` afterwards.
 */
export function untilCancelled(promise: Promise<void>, token: CancellationToken): Promise<void> {
  return new Promise((resolve) => {
    if (token.isCancellationRequested) {
      resolve();
      return;
    }
    const done = (): void => {
      listener.dispose();
      resolve();
    };
    const listener = token.onCancellationRequested(done);
    // Both outcomes are handled, so a rejected `promise` is never an unhandled rejection.
    promise.then(done, done);
  });
}
