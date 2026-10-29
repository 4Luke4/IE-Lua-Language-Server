import assert from 'node:assert/strict';
import { engineReplacement, externalEntry, MANUAL_TITLE, manualEntry } from '../../../../src/server/hover/knowledge.ts';

describe('server/hover/knowledge', () => {
  it('looks up manual entries with their section and link', () => {
    const entry = manualEntry('string.format');
    assert.equal(entry?.kind, 'function');
    assert.equal(entry.heading, 'string.format (formatstring, ···)');
    assert.deepEqual(entry.section, { number: '6.4', title: 'String Manipulation' });
    assert.equal(entry.url, 'https://www.lua.org/manual/5.2/manual.html#pdf-string.format');
    assert.equal(manualEntry('string')?.url, 'https://www.lua.org/manual/5.2/manual.html#6.4');
    assert.equal(manualEntry('_G')?.kind, 'value');
    assert.equal(MANUAL_TITLE, 'Lua 5.2 Reference Manual');
  });

  it('has no manual entries for libraries the engine does not open', () => {
    for (const name of ['io', 'io.write', 'os.time', 'coroutine', 'coroutine.wrap', 'require', 'package.path']) {
      assert.equal(manualEntry(name), undefined, name);
    }
  });

  it('knows that the engine replaces print, citing IESDP', () => {
    assert.deepEqual(engineReplacement('print'), {
      name: 'print',
      sourceTitle: 'Engine Lua globals',
      url: 'https://gibberlings3.github.io/iesdp/file_formats/ie_formats/lua_globals.htm',
    });
    assert.equal(engineReplacement('tostring'), undefined);
  });

  it('looks up EEex and game functions by their documented name', () => {
    assert.equal(externalEntry('EEex_AIBase_GetScriptLevel')?.sourceTitle, 'EEex Functions');
    assert.equal(externalEntry('Infinity_DisplayString')?.sourceTitle, 'EE Game Lua Functions');
    assert.match(externalEntry('C:AddGold')?.url ?? '', /^https:\/\/eeex-docs\.readthedocs\.io\/en\/latest\/EE%20Game%20Lua%20Functions\//);
    // Game structures are types, not Lua names.
    assert.equal(externalEntry('CGameSprite'), undefined);
  });
});
