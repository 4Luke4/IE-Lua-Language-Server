import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { DOCS_BASE, parseInventory, sectionEntries } from '../../../../scripts/eeex-docs/inventory.mts';

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
});
