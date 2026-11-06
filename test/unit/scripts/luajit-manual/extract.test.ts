import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  compiledLines,
  evaluateCondition,
  extractEntries,
  libraryNames,
  LuaJitFormatError,
  openedLibraries,
  pageInfo,
  registeredNames,
  type Registrations,
} from '../../../../scripts/luajit-manual/extract.mts';
import type { LuaJitData } from '../../../../scripts/luajit-manual/generate.mts';

const FLAGS = { LJ_52: true, LJ_HASFFI: true, LJ_HASJIT: false, LUAJIT_DISABLE_X: false };

describe('scripts/luajit-manual/extract', () => {
  describe('preprocessor conditions', () => {
    it('evaluates flags, defined(), !, &&, || and parentheses', () => {
      assert.equal(evaluateCondition('LJ_52', FLAGS, 'f'), true);
      assert.equal(evaluateCondition('!LJ_52 || LJ_HASJIT', FLAGS, 'f'), false);
      assert.equal(evaluateCondition('LJ_52 && (LJ_HASJIT || defined(LJ_HASFFI))', FLAGS, 'f'), true);
      assert.equal(evaluateCondition('!defined(LUAJIT_DISABLE_X) /* c */', FLAGS, 'f'), true);
    });

    it('stops on anything it does not know, naming it', () => {
      assert.throws(() => evaluateCondition('LJ_TARGET_ARM', FLAGS, 'lib_x.c:3'), /lib_x\.c:3.*LJ_TARGET_ARM/);
      assert.throws(() => evaluateCondition('LJ_ARCH_VERSION >= 20', FLAGS, 'f'), LuaJitFormatError);
      assert.throws(() => evaluateCondition('(LJ_52', FLAGS, 'f'), LuaJitFormatError);
    });

    it('keeps the lines of the active branches, evaluating only conditions around relevant lines', () => {
      const source = ['a1', '#if LJ_52', 'a2', '#else', 'a3', '#endif', '#if LJ_UNKNOWN', 'b1', '#endif', '#if LJ_HASJIT', 'a4', '#elif LJ_HASFFI', 'a5', '#endif'].join('\n');
      const kept = compiledLines(source, 'f', FLAGS, (line) => line.startsWith('a')).map(({ line }) => line);
      assert.deepEqual(kept, ['a1', 'a2', 'a5']);
      assert.throws(() => compiledLines(source, 'f', FLAGS, () => true), /LJ_UNKNOWN/);
    });
  });

  describe('registrations', () => {
    const lualib = '#define LUA_TABLIBNAME\t"table"\n#define LUA_BITLIBNAME\t"bit"\n#define LUA_FFILIBNAME\t"ffi"\n';

    it('reads the libraries luaL_openlibs opens and preloads', () => {
      const libInit = [
        'static const luaL_Reg lj_lib_load[] = {',
        '  { "",\t\tluaopen_base },',
        '  { LUA_TABLIBNAME,\tluaopen_table },',
        '  { LUA_BITLIBNAME,\tluaopen_bit },',
        '  { NULL,\t\tNULL }',
        '};',
        'static const luaL_Reg lj_lib_preload[] = {',
        '#if LJ_HASFFI',
        '  { LUA_FFILIBNAME,\tluaopen_ffi },',
        '#endif',
        '  { NULL,\t\tNULL }',
        '};',
      ].join('\n');
      assert.deepEqual(openedLibraries(libInit, libraryNames(lualib), FLAGS), { load: ['_G', 'table', 'bit'], preload: ['ffi'] });
      assert.deepEqual(openedLibraries(libInit, libraryNames(lualib), { ...FLAGS, LJ_HASFFI: false }).preload, []);
    });

    it('reads the names a library registers, with its conditions', () => {
      const source = [
        '#define LJLIB_MODULE_table',
        'LJLIB_CF(table_maxn)',
        'LJLIB_LUA(table_remove) /*',
        '#if LJ_52',
        'LJLIB_CF(table_pack)',
        '#endif',
        '#if !LJ_52',
        'LJLIB_CF(table_old)',
        '#endif',
        'LJLIB_NOREG LJLIB_CF(table_new)\t\tLJLIB_REC(.)',
        'LJLIB_PUSH(3.14) LJLIB_SET(pi)',
        'LUALIB_API int luaopen_table(lua_State *L)',
        '{',
        '#if LJ_52',
        '  lua_setfield(L, -2, "unpack");',
        '#endif',
        '  lj_lib_prereg(L, LUA_TABLIBNAME ".new", luaopen_table_new, tabV(L->top-1));',
        '}',
      ].join('\n');
      const prereg: [string, string][] = [];
      assert.deepEqual(registeredNames(source, 'lib_table.c', FLAGS, prereg), ['table.maxn', 'table.remove', 'table.pack', 'table.pi', 'table.unpack']);
      assert.deepEqual(prereg, [['LUA_TABLIBNAME', 'new']]);
    });

    it('names buffer methods and functions as Lua code writes them, and skips metamethods and FFI metatables', () => {
      const source = [
        '#define LJLIB_MODULE_buffer_method',
        'LJLIB_CF(buffer_method_put)',
        'LJLIB_CF(buffer_method___gc)',
        'LJLIB_PUSH("buffer") LJLIB_SET(__metatable)',
        '#define LJLIB_MODULE_buffer',
        'LJLIB_PUSH(top-2) LJLIB_SET(!)',
        'LJLIB_CF(buffer_new)',
        '#define LJLIB_MODULE_ffi_meta',
        'LJLIB_CF(ffi_meta___index)',
        'int luaopen_string_buffer(lua_State *L)',
        '  lua_setfield(L, -2, "tostring");',
      ].join('\n');
      assert.deepEqual(registeredNames(source, 'lib_buffer.c', FLAGS, []), ['string.buffer:put', 'string.buffer.new', 'string.buffer:tostring']);
    });

    it('refuses a registration that does not belong to its module', () => {
      assert.throws(() => registeredNames('#define LJLIB_MODULE_bit\nLJLIB_CF(math_abs)', 'lib_bit.c', FLAGS, []), /math_abs does not belong/);
    });
  });

  describe('entries', () => {
    const page = (id: string, main: string, h1 = 'Library') => ({
      id,
      url: `https://luajit.org/${id}.html`,
      html: `<div id="site"><a href="https://luajit.org"><span>Lua<span id="logo">JIT</span></span></a></div><div id="head"><h1>${h1}</h1></div><div id="main">${main}<br class="flush"></div><div id="foot"></div>`,
    });
    const registrations: Registrations = {
      globals: ['_G', 'table', 'string', 'jit'],
      preload: ['string.buffer', 'table.new'],
      names: ['jit.on', 'jit.off', 'jit.version', 'string.buffer.new', 'string.buffer:put'],
    };
    const PAGES = [
      page(
        'ext_x',
        '<p>Intro.</p><h2 id="a">A</h2><h3 id="new"><tt>local buf = buffer.new()</tt></h3><p>Creates.</p>' +
          '<h3 id="put"><tt>buf = buf:put(x)</tt><span class="lib">FFI</span></h3><p>Appends.</p>' +
          '<h3 id="onoff"><tt>jit.on()<br>\njit.off()</tt></h3><p>Turns.</p>' +
          '<h3 id="on2"><tt>jit.on(func)</tt></h3><p>Per function.</p>' +
          '<h3 id="v"><tt>jit.version</tt></h3><p>Version.</p>' +
          '<h3 id="cb"><tt>cb:free()</tt></h3><p>Frees.</p>' +
          '<h3 id="dump"><tt>table.insert(t)</tt> and <tt>table.new(n, h)</tt> allocates</h3><p>New.</p>' +
          '<h3 id="prose">Not code</h3><p>x</p>',
      ),
    ];

    it('makes one entry per documented name, merging the headings that document it', () => {
      const { entries, omitted } = extractEntries(PAGES, [{ name: 'string.buffer', page: 'ext_x', section: 'intro' }], new Set(['table.insert']), registrations);
      const summary = entries.map((e) => `${e.kind} ${e.name} ${e.require ?? '-'}${e.returns ? ` -> ${e.returns}` : ''} #${e.anchor} ${JSON.stringify(e.heading)} ${e.markdown}`);
      assert.deepEqual(summary, [
        'module string.buffer string.buffer # "string.buffer" Intro.',
        'function string.buffer.new string.buffer -> string.buffer #new "local buf = buffer.new()" Creates.',
        'method string.buffer:put string.buffer -> string.buffer #put "buf = buf:put(x)" Appends.',
        'function jit.on - #onoff "jit.on()\\njit.off()\\njit.on(func)" Turns.\n\nPer function.',
        'function jit.off - #onoff "jit.on()\\njit.off()" Turns.',
        'value jit.version - #v "jit.version" Version.',
        'function table.new table.new #dump "table.insert(t)\\ntable.new(n, h)" New.',
      ]);
      assert.deepEqual(
        omitted.map((o) => o.name),
        ['cb:free', 'table.insert'],
      );
    });

    it('refuses a documented name that the sources do not register', () => {
      const pages = [page('p', '<h3 id="x"><tt>jit.missing()</tt></h3><p>x</p>')];
      assert.throws(() => extractEntries(pages, [], new Set(), registrations), /jit\.missing is documented but not registered/);
    });

    it('titles a page with the site name and its heading', () => {
      assert.deepEqual(pageInfo(page('ext_jit', '', '<tt>jit.*</tt> Library')), { id: 'ext_jit', title: 'LuaJIT: jit.* Library', url: 'https://luajit.org/ext_jit.html' });
    });
  });

  describe('data/luajit/manual.json', () => {
    // CI (`npm run luajit-manual -- --check`) proves the file is what the generator makes from the pinned sources.
    const data = JSON.parse(readFileSync(new URL('../../../../data/luajit/manual.json', import.meta.url), 'utf8')) as LuaJitData;

    it('has the libraries luaL_openlibs opens in EEex, which lack only bit32 of the Lua 5.2 data', () => {
      assert.deepEqual(data.globals, ['_G', 'package', 'table', 'io', 'os', 'string', 'math', 'debug', 'bit', 'jit']);
      assert.deepEqual(data.preload, ['ffi', 'jit.profile', 'jit.util', 'string.buffer', 'table.clear', 'table.new']);
      assert.ok(data.lua52Unavailable.every((name) => name === 'bit32' || name.startsWith('bit32.')));
      assert.ok(data.lua52Unavailable.includes('bit32'));
    });

    it('has a unique, linked entry for every name, and requires only for preloaded modules', () => {
      const names = data.entries.map((entry) => entry.name);
      assert.equal(new Set(names).size, names.length);
      const pages = new Set(data.pages.map((p) => p.id));
      for (const entry of data.entries) {
        assert.ok(pages.has(entry.page), entry.name);
        assert.ok(entry.markdown.length > 0 && entry.plaintext.length > 0, entry.name);
        if (entry.require !== undefined) assert.ok(data.preload.includes(entry.require), entry.name);
      }
      for (const name of ['bit.band', 'jit.on', 'string.buffer:put', 'string.buffer.new', 'ffi.new', 'table.new']) assert.ok(names.includes(name), name);
    });
  });
});
