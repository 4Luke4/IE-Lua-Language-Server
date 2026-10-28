import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RENAME_REFUSAL_MESSAGES } from '../../../src/shared/protocol.ts';

describe('shared/protocol', () => {
  it('has a client translation key for every rename refusal message', () => {
    // l10n/bundle.l10n.json is exported from the vscode.l10n.t() calls of src/client (npm run check-l10n).
    const bundle = JSON.parse(readFileSync(new URL('../../../l10n/bundle.l10n.json', import.meta.url), 'utf8')) as Record<string, string>;
    for (const [reason, message] of Object.entries(RENAME_REFUSAL_MESSAGES)) {
      assert.ok(message in bundle, `no vscode.l10n.t() call for the "${reason}" refusal message`);
    }
  });
});
