import assert from 'node:assert/strict';
import { engineReplacement, externalEntry, library, LUA52, LUAJIT, MANUAL_TITLE, manualEntry } from '../../../../src/server/hover/knowledge.ts';

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

  describe('libraries of each runtime', () => {
    it('chooses the library by runtime', () => {
      assert.equal(library('lua52'), LUA52);
      assert.equal(library('luajit'), LUAJIT);
    });

    it('gives LuaJIT every Lua 5.2 entry but bit32, plus its own globals', () => {
      assert.equal(LUAJIT.global('string.format'), LUA52.global('string.format'));
      assert.equal(LUAJIT.global('bit32'), undefined);
      assert.equal(LUAJIT.global('bit32.band'), undefined);
      assert.equal(LUA52.global('bit.band'), undefined);
      const band = LUAJIT.global('bit.band');
      assert.equal(band?.heading, 'y = bit.bor(x1 [,x2...])\ny = bit.band(x1 [,x2...])\ny = bit.bxor(x1 [,x2...])');
      assert.equal(band.url, 'https://bitop.luajit.org/api.html#bor');
      assert.equal(band.linkText, 'BitOp: API Functions');
      assert.equal(LUAJIT.global('jit.version')?.kind, 'value');
      assert.equal(LUAJIT.global('jit')?.url, 'https://luajit.org/extensions.html#jit');
    });

    it('reaches ffi, string.buffer and table.new only through require', () => {
      for (const name of ['ffi', 'ffi.new', 'string.buffer', 'string.buffer.new', 'table.new', 'table.clear']) assert.equal(LUAJIT.global(name), undefined, name);
      assert.equal(LUAJIT.required('ffi')?.kind, 'module');
      assert.equal(LUAJIT.required('table.new')?.kind, 'function');
      assert.equal(LUAJIT.requiredMember('ffi', 'new')?.linkText, 'LuaJIT: ffi.* API Functions');
      assert.equal(LUAJIT.requiredMember('string.buffer', 'new')?.url, 'https://luajit.org/ext_buffer.html#buffer_new');
      assert.ok(LUAJIT.requiredMembers('ffi').some((entry) => entry.name === 'ffi.cast'));
      assert.equal(LUAJIT.required('string'), undefined);
      assert.equal(LUA52.required('ffi'), undefined);
    });

    it('knows the methods of strings and of string buffers', () => {
      assert.equal(LUA52.method('string', 'upper')?.name, 'string.upper');
      assert.equal(LUA52.method('string', 'nope'), undefined);
      assert.equal(LUAJIT.method('string.buffer', 'put')?.kind, 'method');
      assert.equal(LUA52.method('string.buffer', 'put'), undefined);
      assert.ok(LUAJIT.methods('string.buffer').some((entry) => entry.name === 'string.buffer:tostring'));
      assert.deepEqual(
        LUA52.methods('string').map((entry) => entry.name),
        LUA52.globals().filter((entry) => entry.name.startsWith('string.') && entry.kind === 'function').map((entry) => entry.name),
      );
    });
  });
});
