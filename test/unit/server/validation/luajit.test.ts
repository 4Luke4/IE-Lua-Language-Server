import assert from 'node:assert/strict';
import type { LuaChecker } from '../../../../src/server/validation/checker.ts';
import { loadLua52 } from '../../../../src/server/validation/lua52.ts';
import { loadLuaJit } from '../../../../src/server/validation/luajit.ts';

describe('server/validation/luajit (LuaJIT front end, as EEex builds it)', () => {
  let luajit: LuaChecker;
  let lua52: LuaChecker;
  before(async () => {
    [luajit, lua52] = await Promise.all([loadLuaJit(), loadLua52()]);
  });

  it('is the luajit dialect', () => {
    assert.equal(luajit.dialect, 'luajit');
  });

  // LuaJIT extensions (https://luajit.org/extensions.html) that Lua 5.2 rejects.
  for (const [what, source] of [
    ['64-bit integer literals', 'local a, b = 1LL, 0x10ULL'],
    ['imaginary literals', 'local i = 3i'],
    ['\\u{XXXX} escapes', 'local s = "\\u{20AC}"'],
    ['binary literals', 'local n = 0b101'],
  ] as const) {
    it(`accepts ${what}, which Lua 5.2 rejects`, () => {
      assert.equal(luajit.check(source), undefined);
      assert.notEqual(lua52.check(source), undefined);
    });
  }

  it('accepts goto and labels, and the empty statements LUAJIT_ENABLE_LUA52COMPAT enables', () => {
    assert.equal(luajit.check('for i = 1, 3 do\n  if i == 2 then goto continue end\n  ;;\n  ::continue::\nend\n'), undefined);
  });

  it('reports errors in LuaJIT’s words, with the end of the chunk quoted', () => {
    assert.equal(luajit.check('local = 1'), "chunk:1: '<name>' expected near '='");
    assert.equal(luajit.check('function f()\n  return 1\n'), "chunk:3: 'end' expected (to close 'function' at line 1) near '<eof>'");
    assert.equal(luajit.check('x = 1LLL'), "chunk:1: malformed number near '1LLL'");
    assert.equal(luajit.check('x = "abc'), "chunk:1: unfinished string near '<eof>'");
    assert.equal(luajit.check('break'), 'chunk:1: no loop to break');
  });

  it('refuses precompiled bytecode', () => {
    assert.equal(luajit.check('\x1bLJ\x02'), 'attempt to load chunk with wrong mode');
  });

  // The parser lays out frames in two slots, as EEex's x64 GC64 build does (load mode "X",
  // third_party/luajit/validate.c): each call needs one more register than in a 32-bit
  // build, which moves where "too complex" starts. CI compares these with a native x64 build.
  it('needs the registers of two-slot frames, as the x64 build does', () => {
    const call = (n: number): string => `f(${Array.from({ length: n }, () => '1').join(',')})`;
    assert.equal(luajit.check(call(247)), undefined);
    assert.equal(luajit.check(call(248)), "chunk:1: function or expression too complex near '<eof>'");
    const nested = (n: number): string => `f(${'1, f('.repeat(n)}1${')'.repeat(n + 1)}`;
    assert.equal(luajit.check(nested(82)), undefined);
    assert.equal(luajit.check(nested(83)), "chunk:1: function or expression too complex near '('");
  });

  it('stays usable after errors and many 64-bit literals (no finalizer ever runs)', () => {
    for (let i = 0; i < 5000; i++) {
      assert.equal(luajit.check(i % 2 === 0 ? `x = ${String(i)}LL` : 'x = = 1') === undefined, i % 2 === 0);
    }
    assert.equal(luajit.check('return 1'), undefined);
  });

  it('checks text with any bytes, including NUL', () => {
    assert.equal(luajit.check('return "a\0b"'), undefined);
    assert.equal(luajit.check(''), undefined);
  });
});
