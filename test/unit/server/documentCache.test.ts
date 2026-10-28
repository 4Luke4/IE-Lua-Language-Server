import assert from 'node:assert/strict';
import { ParsedDocumentCache, type VersionedDocument } from '../../../src/server/documentCache.ts';

function document(uri: string, version: number, text: string, languageId = 'lua'): VersionedDocument & { reads: number } {
  return {
    uri,
    languageId,
    version,
    reads: 0,
    getText() {
      this.reads++;
      return text;
    },
  };
}

describe('server/documentCache', () => {
  it('parses a document version once and reuses the result', () => {
    const cache = new ParsedDocumentCache();
    const v1 = document('file:///a.lua', 1, 'x = 1');
    const first = cache.get(v1);
    assert.equal(cache.get(v1), first);
    assert.equal(v1.reads, 1);
  });

  it('parses again when the version changes', () => {
    const cache = new ParsedDocumentCache();
    const first = cache.get(document('file:///a.lua', 1, 'x = 1'));
    const second = cache.get(document('file:///a.lua', 2, 'local function f() end'));
    assert.notEqual(second, first);
    assert.equal(second.chunks[0]?.tree.body.body[0]?.kind, 'LocalFunctionStatement');
    assert.equal(cache.size, 1);
  });

  it('detects .menu documents and drops entries on delete', () => {
    const cache = new ParsedDocumentCache();
    assert.equal(cache.get(document('file:///UI.MENU', 1, '`x = 1`', 'plaintext')).kind, 'menu');
    cache.delete('file:///UI.MENU');
    assert.equal(cache.size, 0);
  });
});
