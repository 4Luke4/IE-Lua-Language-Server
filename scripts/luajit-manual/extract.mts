// Pure parts of the LuaJIT library data generator (generate.mts): what LuaJIT's
// sources register, and the entries of its documentation pages. No I/O.
//
// Library availability comes from the C sources of the LuaJIT that EEex runs, not
// from a list written by hand:
//
// - `lib_init.c`: the libraries `luaL_openlibs` opens as globals (`lj_lib_load`) and
//   preloads for `require` (`lj_lib_preload`), named through `lualib.h`;
// - `lib_*.c`: the functions and values each library registers. buildvm turns the
//   `LJLIB_*` markers into the library tables (`LJLIB_CF(string_rep)` is
//   `string.rep`; `LJLIB_NOREG` ones are not stored in the table; `LJLIB_SET(pi)`
//   stores a value); a few names are stored by plain C calls, recognized below
//   (`lua_setfield(L, -2, "unpack")` in a `luaopen_*` function, the `_G` field set in
//   `luaopen_base`); `lj_lib_prereg(L, "table.new", …)` adds a module `require`
//   can load.
//
// Preprocessor conditions around a registration are evaluated with the build's
// feature flags (`Flags`); a condition naming anything else stops the generator, so
// a change upstream cannot silently change the data.

import { convertFragment, decodeEntities } from '../lua-manual/convert.mts';

export class LuaJitFormatError extends Error {}

/** The feature flags of the build, as lj_arch.h derives them (see generate.mts). */
export type Flags = Readonly<Record<string, boolean>>;

// ------------------------------------------------------------ preprocessor

/** Evaluates a `#if` expression made of flags, `defined(X)`, `!`, `&&`, `||` and parentheses. */
export function evaluateCondition(expression: string, flags: Flags, where: string): boolean {
  const tokens = expression.replace(/\/\*.*?\*\//g, ' ').match(/defined\s*\(\s*\w+\s*\)|\w+|&&|\|\||[!()]/g) ?? [];
  let position = 0;
  const flag = (name: string): boolean => {
    const value = flags[name];
    if (value === undefined) throw new LuaJitFormatError(`${where}: the condition "${expression.trim()}" uses ${name}, which is not a known flag.`);
    return value;
  };
  const primary = (): boolean => {
    const token = tokens[position++];
    if (token === undefined) throw new LuaJitFormatError(`${where}: the condition "${expression.trim()}" ends early.`);
    if (token === '!') return !primary();
    if (token === '(') {
      const value = or();
      if (tokens[position++] !== ')') throw new LuaJitFormatError(`${where}: unbalanced parentheses in "${expression.trim()}".`);
      return value;
    }
    const defined = /^defined\s*\(\s*(\w+)\s*\)$/.exec(token);
    if (defined) return flag(defined[1] ?? '');
    if (/^\w+$/.test(token)) return flag(token);
    throw new LuaJitFormatError(`${where}: unexpected "${token}" in "${expression.trim()}".`);
  };
  const and = (): boolean => {
    let value = primary();
    while (tokens[position] === '&&') {
      position++;
      const right = primary();
      value = value && right;
    }
    return value;
  };
  function or(): boolean {
    let value = and();
    while (tokens[position] === '||') {
      position++;
      const right = and();
      value = value || right;
    }
    return value;
  }
  const value = or();
  if (position !== tokens.length) throw new LuaJitFormatError(`${where}: unexpected "${tokens[position] ?? ''}" in "${expression.trim()}".`);
  return value;
}

/**
 * The lines of a C file that the build compiles, with their line numbers. Only
 * conditions around lines that `relevant` accepts are evaluated; the others are
 * left alone (they may use flags this generator does not model).
 */
export function compiledLines(source: string, file: string, flags: Flags, relevant: (line: string) => boolean): { line: string; number: number }[] {
  interface Frame {
    readonly directive: string;
    /** The expressions of the branches so far (`#if`, `#elif`), and whether this is the `#else` branch. */
    readonly conditions: string[];
    elseBranch: boolean;
  }
  const stack: Frame[] = [];
  const result: { line: string; number: number }[] = [];
  source.split(/\r?\n/).forEach((line, index) => {
    const number = index + 1;
    const directive = /^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b(.*)$/.exec(line);
    if (directive) {
      const [, kind = '', rest = ''] = directive;
      const expression = rest.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '').trim();
      if (kind === 'if') stack.push({ directive: `#if ${expression}`, conditions: [expression], elseBranch: false });
      else if (kind === 'ifdef') stack.push({ directive: `#ifdef ${expression}`, conditions: [`defined(${expression})`], elseBranch: false });
      else if (kind === 'ifndef') stack.push({ directive: `#ifndef ${expression}`, conditions: [`!defined(${expression})`], elseBranch: false });
      else if (kind === 'endif') stack.pop();
      else {
        const frame = stack.at(-1);
        if (!frame) throw new LuaJitFormatError(`${file}:${number}: #${kind} without #if.`);
        if (kind === 'elif') frame.conditions.push(expression);
        else frame.elseBranch = true;
      }
      return;
    }
    if (!relevant(line)) return;
    const where = `${file}:${number}`;
    const active = stack.every((frame) => {
      const values = frame.conditions.map((condition) => evaluateCondition(condition, flags, where));
      // The branch the line is in: the last condition, unless it is the #else branch.
      const earlier = frame.elseBranch ? values : values.slice(0, -1);
      return !earlier.some(Boolean) && (frame.elseBranch || values.at(-1) === true);
    });
    if (active) result.push({ line, number });
  });
  return result;
}

// ------------------------------------------------------------ registrations

/** What the build of LuaJIT provides. */
export interface Registrations {
  /** Libraries `luaL_openlibs` opens as globals, in its order (`_G` for the base library). */
  readonly globals: readonly string[];
  /** Modules `require` loads without a file (`ffi`, `string.buffer`, `table.new`, …), sorted. */
  readonly preload: readonly string[];
  /** Every registered name: `print`, `string.rep`, `jit.version`, `string.buffer.new`, `string.buffer:put`. Sorted. */
  readonly names: readonly string[];
}

/** `#define LUA_STRLIBNAME "string"` and friends. */
export function libraryNames(lualib: string): ReadonlyMap<string, string> {
  return new Map([...lualib.matchAll(/^#define\s+(LUA_\w+LIBNAME)\s+"([^"]+)"/gm)].map(([, macro = '', name = '']) => [macro, name]));
}

/** The libraries `luaL_openlibs` loads (`lj_lib_load`) and preloads (`lj_lib_preload`), from lib_init.c. */
export function openedLibraries(libInit: string, names: ReadonlyMap<string, string>, flags: Flags): { load: string[]; preload: string[] } {
  const table = (variable: string): string[] => {
    const match = new RegExp(`static const luaL_Reg ${variable}\\[\\] = \\{([\\s\\S]*?)\\n\\};`).exec(libInit);
    if (!match) throw new LuaJitFormatError(`lib_init.c: the table ${variable} was not found.`);
    const body = match[1] ?? '';
    return compiledLines(body, `lib_init.c ${variable}`, flags, (line) => /\{\s*(?:""|LUA_\w+LIBNAME)\s*,/.test(line)).map(({ line }) => {
      const entry = /\{\s*(""|LUA_\w+LIBNAME)\s*,/.exec(line)?.[1] ?? '';
      if (entry === '""') return '_G';
      const name = names.get(entry);
      if (name === undefined) throw new LuaJitFormatError(`lib_init.c ${variable}: ${entry} is not defined in lualib.h.`);
      return name;
    });
  };
  return { load: table('lj_lib_load'), preload: table('lj_lib_preload') };
}

/** How the `LJLIB_MODULE_*` of a C file names its registrations. */
function moduleName(module: string): { prefix: string; method: boolean } | undefined {
  if (module === 'base') return { prefix: '', method: false };
  // Metatables of FFI objects (`ffi_meta`, `ffi_clib`, `ffi_callback`): not names Lua code writes.
  if (module === 'ffi_meta' || module === 'ffi_clib' || module === 'ffi_callback') return undefined;
  // lib_buffer.c: the methods of buffer objects, and the functions of `require("string.buffer")`.
  if (module === 'buffer_method') return { prefix: 'string.buffer:', method: true };
  if (module === 'buffer') return { prefix: 'string.buffer.', method: false };
  return { prefix: `${module.replace(/_/g, '.')}.`, method: false };
}

const REGISTRATION = /\b(LJLIB_NOREG(?:UV)?\s+)?LJLIB_(?:CF|ASM_?|LUA)\((\w+)\)|\bLJLIB_SET\((\w+)\)/g;

/** The names one `lib_*.c` file registers (see the file header). */
/**
 * `prereg` receives the modules the file preregisters for `require`, as the `lualib.h` macro
 * of their library and the rest of the name (`LUA_TABLIBNAME`, `new`).
 */
export function registeredNames(source: string, file: string, flags: Flags, prereg: [string, string][]): string[] {
  const names: string[] = [];
  let module: string | undefined;
  let luaopen: string | undefined;
  const lines = compiledLines(source, file, flags, (line) =>
    /LJLIB_MODULE_|LJLIB_(?:CF|ASM_?|LUA|SET)\(|lua_setfield\(L, -2, "|lj_str_newlit\(L, "_G"\)|lj_lib_prereg\(|^(?:LUALIB_API )?int luaopen_\w+/.test(line),
  );
  for (const { line, number } of lines) {
    const where = `${file}:${number}`;
    const defined = /#define LJLIB_MODULE_(\w+)/.exec(line);
    if (defined) {
      module = defined[1];
      continue;
    }
    const opener = /^(?:LUALIB_API )?int (luaopen_\w+)/.exec(line);
    if (opener) {
      luaopen = opener[1];
      continue;
    }
    const naming = module === undefined ? undefined : moduleName(module);
    for (const match of line.matchAll(REGISTRATION)) {
      const [, noreg, cname, set] = match;
      if (module === undefined) throw new LuaJitFormatError(`${where}: a registration outside any LJLIB_MODULE.`);
      if (!naming) continue;
      if (cname !== undefined) {
        if (noreg !== undefined) continue;
        const local = module === 'base' ? cname : cname.startsWith(`${module}_`) ? cname.slice(module.length + 1) : undefined;
        if (local === undefined) throw new LuaJitFormatError(`${where}: ${cname} does not belong to LJLIB_MODULE_${module}.`);
        if (!local.startsWith('__')) names.push(`${naming.prefix}${local}`);
      } else if (set !== undefined && set !== '!' && !set.startsWith('__')) {
        names.push(`${naming.prefix}${set}`);
      }
    }
    // `lua_setfield(L, -2, "unpack")` in `luaopen_table`: a field of the library table.
    const field = /lua_setfield\(L, -2, "(\w+)"\)/.exec(line);
    if (field && luaopen !== undefined) {
      const library = luaopen === 'luaopen_string_buffer' ? 'string.buffer:' : luaopen.startsWith('luaopen_') && /^luaopen_[a-z]+$/.test(luaopen) ? `${luaopen.slice(8)}.` : undefined;
      if (library !== undefined && library !== 'jit.') names.push(`${library}${field[1] ?? ''}`);
    }
    // `luaopen_base` stores the global table as `_G`.
    if (/lj_str_newlit\(L, "_G"\)/.test(line) && luaopen === 'luaopen_base') names.push('_G');
    const preregistered = /lj_lib_prereg\(L, (LUA_\w+LIBNAME) "\.(\w+)"/.exec(line);
    if (preregistered) prereg.push([preregistered[1] ?? '', preregistered[2] ?? '']);
  }
  return names;
}

// ------------------------------------------------------------ documentation

/** A page of the documentation, as fetched. */
export interface Page {
  /** `ext_buffer`, `bitop_api`. */
  readonly id: string;
  /** Online URL; links in the text are resolved against it. */
  readonly url: string;
  readonly html: string;
}

export interface PageInfo {
  readonly id: string;
  /** `LuaJIT: String Buffer Library`: the site name and the page's heading. */
  readonly title: string;
  readonly url: string;
}

export interface LuaJitEntry {
  /** `string.buffer`, `string.buffer.new`, `string.buffer:put`, `jit.version`, `bit.band`, `table.new`. */
  readonly name: string;
  readonly kind: 'function' | 'value' | 'module' | 'method';
  readonly page: string;
  /** Fragment of the entry's first heading on its page. */
  readonly anchor: string;
  /** The heading(s) as the page prints them, one form per line. */
  readonly heading: string;
  readonly markdown: string;
  readonly plaintext: string;
  /** The module name to `require` for this entry, when it is not a global (`ffi`, `string.buffer`, `table.new`). */
  readonly require?: string;
}

const textOf = (html: string): string =>
  decodeEntities(html.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, ''), { luajit: true })
    .split('\n')
    .map((line) => line.replace(/[ \t\r]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');

/** The page's main content: between `<div id="main">` and the footer. */
export function mainContent(page: Page): string {
  const start = page.html.indexOf('<div id="main">');
  const end = page.html.indexOf('<div id="foot">');
  if (start < 0 || end < start) throw new LuaJitFormatError(`${page.id}: the main content was not found.`);
  const main = page.html.slice(start + '<div id="main">'.length, end);
  // The main div ends with `<br class="flush">` and its closing tag.
  return main.replace(/<br class="flush">\s*<\/div>\s*$/, '').replace(/<\/div>\s*$/, '');
}

/** `LuaJIT: String Buffer Library`, from `<div id="site">` and the `<h1>` of the page. */
export function pageInfo(page: Page): PageInfo {
  const site = /<div id="site">([\s\S]*?)<\/div>/.exec(page.html)?.[1];
  const heading = /<h1>([\s\S]*?)<\/h1>/.exec(page.html)?.[1];
  if (site === undefined || heading === undefined) throw new LuaJitFormatError(`${page.id}: no site name or <h1>.`);
  return { id: page.id, title: `${textOf(site)}: ${textOf(heading)}`, url: page.url };
}

interface Section {
  readonly level: 2 | 3;
  readonly id: string | undefined;
  readonly headingHtml: string;
  readonly body: string;
}

/** The `<h2>` and `<h3>` sections of the main content, each with the HTML up to the next heading. */
export function sections(main: string): { intro: string; sections: Section[] } {
  const heading = /<h([23])(?: id="([^"]*)")?>([\s\S]*?)<\/h\1>/g;
  const found: { level: 2 | 3; id: string | undefined; headingHtml: string; start: number; end: number }[] = [];
  for (let match = heading.exec(main); match; match = heading.exec(main)) {
    found.push({ level: match[1] === '2' ? 2 : 3, id: match[2], headingHtml: match[3] ?? '', start: match.index, end: match.index + match[0].length });
  }
  return {
    intro: main.slice(0, found[0]?.start ?? main.length),
    sections: found.map((section, i) => ({ ...section, body: main.slice(section.end, found[i + 1]?.start ?? main.length) })),
  };
}

/** The names a heading documents, as Lua code writes them (`buffer.new`, `buf:put`, `jit.on`, `bit.band`). */
const DOCUMENTED_NAME = /(?<![\w.:])(buffer|buf|jit|ffi|bit|table|cb)((?:[.:][A-Za-z_]\w*)+)/g;

/** Names documented on the pages but left out, with the reason; recorded in the data file. */
export interface Omission {
  readonly name: string;
  readonly reason: string;
}

export interface Extracted {
  readonly entries: LuaJitEntry[];
  readonly omitted: Omission[];
}

/**
 * The entries of the pages: every `<h3>` whose heading documents names of the LuaJIT
 * libraries (`DOCUMENTED_NAME`), one entry per name (a name documented under several
 * headings gets all of them), plus the module entries `modules` asks for.
 *
 * - `buffer.x` and `buf:x` are `string.buffer.x` and the method `string.buffer:x`
 *   (ext_buffer.html: "`buffer` refers to the buffer library and `buf` refers to an
 *   individual buffer object").
 * - `cb:x` (callbacks) are left out: what a variable holds a callback is not known.
 * - Names the Lua 5.2 manual documents (`string.dump` in "Enhanced Standard Library
 *   Functions") are left out: that page describes LuaJIT's differences, not the function.
 * - Every name must be registered by the sources, or be preloaded (`table.new`).
 */
export function extractEntries(
  pages: readonly Page[],
  /** `section`: the `id` of the heading whose text describes the module, or `intro` for the text before the first heading. */
  modules: readonly { readonly name: string; readonly page: string; readonly section: string }[],
  lua52: ReadonlySet<string>,
  registrations: Registrations,
): Extracted {
  const registered = new Set(registrations.names);
  const preload = new Set(registrations.preload);
  const byName = new Map<string, { entry: LuaJitEntry; headings: string[]; markdown: string[]; plaintext: string[] }>();
  const omitted: Omission[] = [];
  const omit = (name: string, reason: string): void => {
    if (!omitted.some((o) => o.name === name)) omitted.push({ name, reason });
  };
  const convert = (html: string, page: Page, where: string): { markdown: string; plaintext: string } => {
    try {
      return convertFragment(html, page.url, { luajit: true });
    } catch (error) {
      throw new LuaJitFormatError(`${page.id} ${where}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  /**
   * The preloaded module that provides `name`: the name itself (`table.new`, a function that is
   * not stored in `table`), or the longest preloaded module it is a member of (`string.buffer`).
   */
  const requireFor = (name: string): string | undefined => {
    if (preload.has(name)) return name;
    const module = [...preload].filter((candidate) => name.startsWith(`${candidate}.`) || name.startsWith(`${candidate}:`)).sort((a, b) => b.length - a.length)[0];
    return module;
  };
  const available = (name: string): boolean => registered.has(name) || preload.has(name);

  const parsed = new Map(pages.map((page) => [page.id, { page, ...sections(mainContent(page)) }]));
  for (const { page, sections: pageSections } of parsed.values()) {
    for (const section of pageSections) {
      if (section.level !== 3) continue;
      // The code of the heading: its `<tt>` elements, one form per line. The rest is prose
      // (extensions.html: `<tt>table.new(narray, nhash)</tt> allocates a pre-sized table`)
      // or the `FFI` labels of ext_buffer.html.
      const headingText = [...section.headingHtml.matchAll(/<tt>([\s\S]*?)<\/tt>/g)].map(([, code = '']) => textOf(code)).join('\n');
      const lines = headingText.split('\n');
      const names = new Map<string, boolean>();
      for (const line of lines) {
        for (const match of line.matchAll(DOCUMENTED_NAME)) {
          const [written = '', prefix = '', rest = ''] = match;
          const after = line.slice(match.index + written.length);
          const isFunction = /^\s*\(/.test(after);
          let name: string | undefined;
          if (prefix === 'buffer') name = `string.buffer${rest}`;
          else if (prefix === 'buf') name = rest.startsWith(':') ? `string.buffer${rest}` : undefined;
          else if (prefix === 'cb') {
            omit(written, 'a method of FFI callback objects: which variable holds a callback cannot be known');
            continue;
          } else name = written;
          if (name === undefined) continue;
          if (lua52.has(name)) {
            omit(name, 'documented by the Lua 5.2 manual; the page describes how LuaJIT differs');
            continue;
          }
          names.set(name, (names.get(name) ?? false) || isFunction);
        }
      }
      if (names.size === 0) continue;
      const { markdown, plaintext } = convert(section.body, page, `#${section.id ?? ''}`);
      for (const [name, isFunction] of names) {
        if (!available(name)) {
          throw new LuaJitFormatError(`${page.id} #${section.id ?? ''}: ${name} is documented but not registered by the LuaJIT sources.`);
        }
        const existing = byName.get(name);
        if (existing) {
          existing.headings.push(headingText);
          existing.markdown.push(markdown);
          existing.plaintext.push(plaintext);
          continue;
        }
        const method = name.includes(':');
        const kind: LuaJitEntry['kind'] = method ? 'method' : isFunction ? 'function' : 'value';
        const require = requireFor(name);
        byName.set(name, {
          entry: { name, kind, page: page.id, anchor: section.id ?? '', heading: '', markdown: '', plaintext: '', ...(require === undefined ? {} : { require }) },
          headings: [headingText],
          markdown: [markdown],
          plaintext: [plaintext],
        });
      }
    }
  }

  const entries: LuaJitEntry[] = [];
  for (const { name, page: pageId, section } of modules) {
    const pageData = parsed.get(pageId);
    if (!pageData) throw new LuaJitFormatError(`Module ${name}: no page ${pageId}.`);
    const found = section === 'intro' ? { body: pageData.intro, id: undefined } : pageData.sections.find((s) => s.id === section);
    if (!found) throw new LuaJitFormatError(`Module ${name}: ${pageId} has no section #${section}.`);
    if (!registrations.globals.includes(name) && !registrations.preload.includes(name)) {
      throw new LuaJitFormatError(`Module ${name} is neither opened nor preloaded by luaL_openlibs.`);
    }
    entries.push({
      name,
      kind: 'module',
      page: pageId,
      anchor: found.id ?? '',
      heading: name,
      ...convert(found.body, pageData.page, `module ${name}`),
      ...(registrations.preload.includes(name) ? { require: name } : {}),
    });
  }
  for (const { entry, headings, markdown, plaintext } of byName.values()) {
    entries.push({ ...entry, heading: headings.join('\n'), markdown: markdown.join('\n\n'), plaintext: plaintext.join('\n\n') });
  }
  return { entries, omitted };
}
