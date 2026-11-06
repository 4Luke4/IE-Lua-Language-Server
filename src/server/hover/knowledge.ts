// What the server knows about names it did not see defined: the libraries of the
// Lua the game runs (`ieLua.runtime.lua`: the engine's Lua 5.2, or the LuaJIT of
// EEex's "Use LuaJIT" component), the engine's replacements of standard functions,
// and the EEex and game functions documented by EEex-Docs.
// Pure: no LSP or `vscode` imports.
import eeexFunctions from '../../../data/eeex/eeex-functions.json' with { type: 'json' };
import gameLuaFunctions from '../../../data/eeex/game-lua-functions.json' with { type: 'json' };
import manual from '../../../data/lua52/manual.json' with { type: 'json' };
import luajitManual from '../../../data/luajit/manual.json' with { type: 'json' };
import type { Runtime } from '../../shared/settings.ts';

// ------------------------------------------------------------ libraries

export interface ManualSection {
  /** `6.4`. */
  readonly number: string;
  /** `String Manipulation`. */
  readonly title: string;
}

/**
 * A documented library name: an entry of the Lua 5.2 manual (data/lua52/manual.json,
 * scripts/lua-manual/) or of the LuaJIT documentation (data/luajit/manual.json,
 * scripts/luajit-manual/).
 */
export interface ManualEntry {
  /** `print`, `string.format`, `bit.band`, `string.buffer:put`, or the module name for a module table. */
  readonly name: string;
  /** `method`: a method of objects of a type (`string.buffer:put`; LuaJIT only). */
  readonly kind: 'function' | 'value' | 'module' | 'method';
  /** The manual section (Lua 5.2 entries only). */
  readonly section?: ManualSection;
  /** The heading as the documentation prints it: `string.format (formatstring, ···)`, `buf = buf:put([str|num|obj] [,…])`. */
  readonly heading: string;
  readonly markdown: string;
  readonly plaintext: string;
  /** Link to the entry in the online documentation. */
  readonly url: string;
  /** The text of that link: `Lua 5.2 Reference Manual, §6.4 – String Manipulation`, `LuaJIT: String Buffer Library`. */
  readonly linkText: string;
  /**
   * The module `require` must load to reach the entry (`ffi`, `string.buffer`, `table.new`),
   * when it is not reachable from the globals.
   */
  readonly require?: string;
}

export const MANUAL_TITLE: string = manual.title;

const ENTRY_KINDS: ReadonlySet<string> = new Set(['function', 'value', 'module', 'method']);

/** The Lua 5.2 manual entries. The data is generated and checked in CI; a malformed file fails at load. */
const lua52Entries: readonly ManualEntry[] = (() => {
  const sections = new Map(manual.sections.map((section) => [section.number, { number: section.number, title: section.title }]));
  return manual.entries.map((entry): ManualEntry => {
    const section = sections.get(entry.section);
    if (!section || !ENTRY_KINDS.has(entry.kind) || entry.kind === 'method') {
      throw new Error(`data/lua52/manual.json: entry "${entry.name}" has an unknown section or kind.`);
    }
    return {
      name: entry.name,
      kind: entry.kind as ManualEntry['kind'],
      section,
      heading: entry.heading,
      markdown: entry.markdown,
      plaintext: entry.plaintext,
      url: `${manual.baseUrl}#${encodeURI(entry.anchor)}`,
      linkText: `${MANUAL_TITLE}, §${section.number} – ${section.title}`,
    };
  });
})();

/** The LuaJIT entries (data/luajit/manual.json); a malformed file fails at load. */
const luajitEntries: readonly ManualEntry[] = (() => {
  const pages = new Map(luajitManual.pages.map((page) => [page.id, page]));
  return luajitManual.entries.map((entry): ManualEntry => {
    const page = pages.get(entry.page);
    if (!page || !ENTRY_KINDS.has(entry.kind)) throw new Error(`data/luajit/manual.json: entry "${entry.name}" has an unknown page or kind.`);
    return {
      name: entry.name,
      kind: entry.kind as ManualEntry['kind'],
      heading: entry.heading,
      markdown: entry.markdown,
      plaintext: entry.plaintext,
      url: entry.anchor === '' ? page.url : `${page.url}#${encodeURI(entry.anchor)}`,
      linkText: page.title,
      ...('require' in entry && typeof entry.require === 'string' ? { require: entry.require } : {}),
    };
  });
})();

/**
 * The documented libraries of one runtime. Names are as Lua code writes them from the
 * globals (`string.format`) or from what `require` returns (`ffi.new` for
 * `local ffi = require("ffi")`); methods are `type:name` (`string.buffer:put`).
 */
export interface Library {
  readonly runtime: Runtime;
  /** Any entry by its documented name, including methods and entries reached through `require`. */
  entry(name: string): ManualEntry | undefined;
  /** The entry for a global or a member of a global library (`print`, `string.format`, `bit.band`); never one reached only through `require`, nor a method. */
  global(name: string): ManualEntry | undefined;
  /** Every entry `global` finds, in the documentation's order. */
  globals(): readonly ManualEntry[];
  /** What `require(module)` returns, when it is documented: a module table (`ffi`) or a function (`table.new`). */
  required(module: string): ManualEntry | undefined;
  /** A member of a module `require` returns: `ffi.new` for `required('ffi')`. */
  requiredMember(module: string, member: string): ManualEntry | undefined;
  /** Every member of such a module (`ffi.*`, `string.buffer.*`), in the documentation's order. */
  requiredMembers(module: string): readonly ManualEntry[];
  /**
   * The method `name` of values of `type`: `string` (strings have the string library as
   * their metatable's `__index`, Lua 5.2 manual §6.4; LuaJIT does the same, lib_string.c)
   * or `string.buffer` (buffer objects, ext_buffer.html).
   */
  method(type: string, name: string): ManualEntry | undefined;
  /** Every method of values of `type`. */
  methods(type: string): readonly ManualEntry[];
}

function makeLibrary(runtime: Runtime, entries: readonly ManualEntry[]): Library {
  const globals = entries.filter((entry) => entry.require === undefined && entry.kind !== 'method');
  const byGlobal = new Map(globals.map((entry) => [entry.name, entry]));
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const required = (module: string): ManualEntry | undefined => {
    const entry = byName.get(module);
    return entry?.require === module ? entry : undefined;
  };
  const methods = (type: string): readonly ManualEntry[] =>
    type === 'string'
      ? globals.filter((entry) => entry.kind === 'function' && entry.name.startsWith('string.'))
      : entries.filter((entry) => entry.kind === 'method' && entry.name.startsWith(`${type}:`));
  return {
    runtime,
    entry: (name) => byName.get(name),
    global: (name) => byGlobal.get(name),
    globals: () => globals,
    required,
    requiredMember: (module, member) => {
      const entry = byName.get(`${module}.${member}`);
      return required(module) !== undefined && entry?.require === module && entry.kind !== 'method' ? entry : undefined;
    },
    requiredMembers: (module) => (required(module) === undefined ? [] : entries.filter((entry) => entry.require === module && entry.name.startsWith(`${module}.`))),
    method: (type, name) => {
      if (type === 'string') {
        const entry = byGlobal.get(`string.${name}`);
        return entry?.kind === 'function' ? entry : undefined;
      }
      const entry = byName.get(`${type}:${name}`);
      return entry?.kind === 'method' ? entry : undefined;
    },
    methods,
  };
}

/** The engine's Lua 5.2: only the libraries it opens (CLAUDE.md, section 7). */
export const LUA52: Library = makeLibrary('lua52', lua52Entries);

/**
 * EEex's LuaJIT: the Lua 5.2 entries it provides (all but `bit32`; the data lists what it
 * lacks), then the LuaJIT libraries. io, os, package and coroutines exist there, but neither
 * source documents them in the scope of plan.md, so they stay undocumented as with Lua 5.2.
 */
export const LUAJIT: Library = (() => {
  const unavailable = new Set(luajitManual.lua52Unavailable);
  return makeLibrary('luajit', [...lua52Entries.filter((entry) => !unavailable.has(entry.name)), ...luajitEntries]);
})();

export function library(runtime: Runtime): Library {
  return runtime === 'luajit' ? LUAJIT : LUA52;
}

/** The Lua 5.2 manual entry named `name` (`print`, `string`, `string.format`); only the libraries the engine opens are included. */
export function manualEntry(name: string): ManualEntry | undefined {
  return LUA52.global(name);
}

/** Every Lua 5.2 manual entry, in the manual's order. */
export function allManualEntries(): readonly ManualEntry[] {
  return LUA52.globals();
}

// ------------------------------------------------- engine replacements

/** A standard function the engine replaces, so the manual does not describe it. */
export interface EngineReplacement {
  readonly name: string;
  /** Title of the page that documents the replacement. */
  readonly sourceTitle: string;
  readonly url: string;
}

// IESDP, "Engine Lua globals" (https://gibberlings3.github.io/iesdp/file_formats/ie_formats/lua_globals.htm,
// commit 38e7532; checked against the 2.6.6.0 and 2.7.3.0 executables): `bootstrapLua` "replaces `print`";
// its entry reads "Replacement for Lua's print, registered by the engine's Lua bootstrap." and gives no behaviour.
const ENGINE_REPLACEMENTS: ReadonlyMap<string, EngineReplacement> = new Map([
  ['print', { name: 'print', sourceTitle: 'Engine Lua globals', url: 'https://gibberlings3.github.io/iesdp/file_formats/ie_formats/lua_globals.htm' }],
]);

export function engineReplacement(name: string): EngineReplacement | undefined {
  return ENGINE_REPLACEMENTS.get(name);
}

// --------------------------------------------------------------- EEex-Docs

/** A function documented by EEex-Docs. Only the name and link are stored: EEex-Docs has no license. */
export interface ExternalEntry {
  /** As documented: `EEex_Sprite_GetName`, `Infinity_DisplayString`, `C:AddGold`, `EEex_Options_Option.new`. */
  readonly name: string;
  readonly url: string;
  /** The documentation section: `EEex Functions` or `EE Game Lua Functions`. */
  readonly sourceTitle: string;
}

// Game structures (game-structures-x64.json) are C++ types that Lua code never
// names as variables, so they are not looked up.
const externalEntries: ReadonlyMap<string, ExternalEntry> = new Map(
  [eeexFunctions, gameLuaFunctions].flatMap(({ title, entries }) => entries.map(({ name, url }) => [name, { name, url, sourceTitle: title }] as const)),
);

/** The EEex-Docs entry for `name` as it is documented (`x`, `x.y` or `x:y`). */
export function externalEntry(name: string): ExternalEntry | undefined {
  return externalEntries.get(name);
}

/** Every EEex-Docs entry, EEex Functions first, each section in its published order. */
export function allExternalEntries(): readonly ExternalEntry[] {
  return [...externalEntries.values()];
}
