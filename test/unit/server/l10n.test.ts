import assert from 'node:assert/strict';
import { createMessages, format, messagesFrom, resolveLocale, type MessageKey } from '../../../src/server/l10n.ts';

describe('server/l10n', () => {
  it('resolves a requested locale exactly, case-insensitively', () => {
    assert.equal(resolveLocale('de'), 'de');
    assert.equal(resolveLocale('pt-BR'), 'pt-br');
    assert.equal(resolveLocale('zh_TW'), 'zh-tw');
  });

  it('falls back to the bare language, never to another regional variant, and otherwise to English', () => {
    assert.equal(resolveLocale('de-AT'), 'de');
    assert.equal(resolveLocale('fr-CA'), 'fr');
    assert.equal(resolveLocale('pt-PT'), undefined);
    assert.equal(resolveLocale('pt'), undefined);
    assert.equal(resolveLocale('zh-Hans'), undefined);
    assert.equal(resolveLocale('en'), undefined);
    assert.equal(resolveLocale('en-US'), undefined);
    assert.equal(resolveLocale('xx'), undefined);
    assert.equal(resolveLocale(''), undefined);
    assert.equal(resolveLocale(undefined), undefined);
  });

  it('replaces numbered placeholders and keeps unmatched ones', () => {
    assert.equal(format('See {0} and {1}; {0}.', ['a', 'b']), 'See a and b; a.');
    assert.equal(format('Missing {2}', ['a']), 'Missing {2}');
  });

  it('uses the translation, then English, then the key', () => {
    const messages = messagesFrom({ greet: 'Hello {0}', only: 'English only' }, { greet: 'Hallo {0}' }, 'de');
    // The keys are not in the bundled English table; the cast only satisfies MessageKey.
    const t = (key: string, ...args: string[]): string => messages.t(key as MessageKey, ...args);
    assert.equal(messages.locale, 'de');
    assert.equal(t('greet', 'Welt'), 'Hallo Welt');
    assert.equal(t('only'), 'English only');
    assert.equal(t('unknown'), 'unknown');
  });

  it('creates messages for the resolved locale', () => {
    assert.equal(createMessages('ja').locale, 'ja');
    assert.equal(createMessages('en-GB').locale, undefined);
  });
});
