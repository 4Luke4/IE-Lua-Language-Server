import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { DOCS_BASE, isCommitSha, isSafeEntry, parseInventory, sectionEntries } from '../../../../scripts/eeex-docs/inventory.mts';
import type { EeexDataFile } from '../../../../scripts/eeex-docs/sync.mts';

/** Builds a Sphinx v2 inventory in memory. */
function inventory(lines: string[]): Buffer {
  const header = '# Sphinx inventory version 2\n# Project: Test\n# Version: 1.0\n# The remainder of this file is compressed using zlib.\n';
  return Buffer.concat([Buffer.from(header), deflateSync(Buffer.from(lines.join('\n') + '\n'))]);
}

const SAMPLE = inventory([
  'c_addgold std:label -1 EE%20Game%20Lua%20Functions/C/C_AddGold.html#c-addgold C:AddGold',
  'caiaction std:label -1 EE%20Game%20Structures%20%28x64%29/CA/index.html#$ CAIAction',
  'ca structures std:label -1 EE%20Game%20Structures%20%28x64%29/CA/index.html#ca-structures CA Structures',
  'eeex_menu_unscalex std:label -1 EEex%20Functions/Menu/index.html#eeex-menu-unscalex EEex_Menu_UnscaleX',
  'EEex Functions/index std:doc -1 EEex%20Functions/index.html EEex Functions',
  'self std:label -1 EEex%20Functions/Menu/index.html#self -',
]);

describe('scripts/eeex-docs/inventory', () => {
  it('parses inventory lines, including names with spaces', () => {
    const items = parseInventory(SAMPLE);
    assert.equal(items.length, 6);
    assert.deepEqual(items[2], {
      name: 'ca structures',
      role: 'std:label',
      uri: 'EE%20Game%20Structures%20%28x64%29/CA/index.html#ca-structures',
      display: 'CA Structures',
    });
  });

  it('expands the $ and - shorthands', () => {
    const items = parseInventory(SAMPLE);
    assert.equal(items[1]?.uri, 'EE%20Game%20Structures%20%28x64%29/CA/index.html#caiaction');
    assert.equal(items[5]?.display, 'self');
  });

  it('rejects other inventory formats', () => {
    assert.throws(() => parseInventory(Buffer.from('# Sphinx inventory version 1\n# Project: x\n# Version: 1\nfoo\n')), /Unsupported inventory header/);
  });

  it('keeps only identifier labels with anchors from the requested section', () => {
    const items = parseInventory(SAMPLE);
    assert.deepEqual(sectionEntries(items, 'EE Game Structures (x64)'), [
      { name: 'CAIAction', url: `${DOCS_BASE}EE%20Game%20Structures%20%28x64%29/CA/index.html#caiaction` },
    ]);
    assert.deepEqual(
      sectionEntries(items, 'EEex Functions').map((entry) => entry.name),
      ['EEex_Menu_UnscaleX', 'self'],
    );
    assert.deepEqual(sectionEntries(items, 'EE Game Lua Functions').map((entry) => entry.name), ['C:AddGold']);
  });

  it('accepts only full lowercase commit SHAs', () => {
    assert.equal(isCommitSha('2b175c02656e12ba22fa56c311d564e41bd0cae4'), true);
    assert.equal(isCommitSha('2b175c0'), false);
    assert.equal(isCommitSha('2B175C02656E12BA22FA56C311D564E41BD0CAE4'), false);
    assert.equal(isCommitSha('2b175c02656e12ba22fa56c311d564e41bd0cae4\nchanged=true'), false);
    assert.equal(isCommitSha('2b175c02656e12ba22fa56c311d564e41bd0cae4 '), false);
    assert.equal(isCommitSha(undefined), false);
    assert.equal(isCommitSha(42), false);
  });

  it('accepts every entry sectionEntries produces', () => {
    const items = parseInventory(SAMPLE);
    const entries = ['EE Game Structures (x64)', 'EEex Functions', 'EE Game Lua Functions'].flatMap((directory) => sectionEntries(items, directory));
    assert.equal(entries.length, 4);
    assert.ok(entries.every(isSafeEntry));
  });

  it('rejects entries that are not an identifier with a deep link inside the docs', () => {
    const name = 'EEex_Menu_UnscaleX';
    const path = 'EEex%20Functions/Menu/index.html#eeex-menu-unscalex';
    assert.equal(isSafeEntry({ name, url: DOCS_BASE + path }), true);
    for (const url of [
      `https://example.com/en/latest/${path}`,
      `http://eeex-docs.readthedocs.io/en/latest/${path}`,
      `javascript:alert(1)//${DOCS_BASE}${path}`,
      `${DOCS_BASE}EEex%20Functions/Menu/index.html`, // no anchor
      `${DOCS_BASE}EEex%20Functions/Menu/index.html#a#b`,
      `${DOCS_BASE}EEex Functions/Menu/index.html#eeex-menu-unscalex`, // whitespace
      `${DOCS_BASE}${path}\n`,
      `${DOCS_BASE}${path})`, // ends a Markdown link
      `${DOCS_BASE}${path}](https://example.com)`,
      `${DOCS_BASE}${path}"`,
      `${DOCS_BASE}${path}<`,
      `${DOCS_BASE}EEex%2/index.html#x`, // malformed percent-encoding
      `${DOCS_BASE}../../other/index.html#x`,
      `${DOCS_BASE}EEex%20Functions/./index.html#x`,
    ]) {
      assert.equal(isSafeEntry({ name, url }), false, url);
    }
    for (const bad of ['CA Structures', 'EEex_Menu_UnscaleX)', '1abc', '', 'a..b']) {
      assert.equal(isSafeEntry({ name: bad, url: DOCS_BASE + path }), false, bad);
    }
    assert.equal(isSafeEntry({ name: 1, url: DOCS_BASE + path }), false);
    assert.equal(isSafeEntry({ name, url: null }), false);
  });

  it('holds for the committed data files', () => {
    const directory = new URL('../../../../data/eeex/', import.meta.url);
    const files = readdirSync(directory).filter((file) => file.endsWith('.json'));
    assert.deepEqual(files.sort(), ['eeex-functions.json', 'game-lua-functions.json', 'game-structures-x64.json']);
    for (const file of files) {
      const data = JSON.parse(readFileSync(new URL(file, directory), 'utf8')) as EeexDataFile;
      assert.ok(isCommitSha(data.upstream.buildCommit), `${file}: buildCommit`);
      assert.ok(isCommitSha(data.upstream.sourceCommit), `${file}: sourceCommit`);
      assert.ok(data.entries.length > 0, `${file}: entries`);
      const unsafe = data.entries.filter((entry) => !isSafeEntry(entry));
      assert.deepEqual(unsafe, [], `${file}: unsafe entries`);
    }
  });
});
