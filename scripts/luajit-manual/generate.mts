// Generates data/luajit/manual.json, the LuaJIT library reference shown in hovers
// and completion when `ieLua.runtime` is `luajit`, from LuaJIT's own documentation.
//
//   npm run luajit-manual              regenerate the data file
//   npm run luajit-manual -- --check   fail if the committed file differs from a fresh run
//
// Which LuaJIT: the one EEex runs. EEex's "Use LuaJIT" component (EEex.tp2,
// B3-EEex-LuaJIT) installs the lua51.dll that Bubb13/InfinityLoader builds from the
// LuaJIT copy in its LuaJIT/ folder; LuaJIT/VERSION.TXT there names the upstream
// commit it is, and LuaJIT/src/msvcbuild.bat builds it. In that mode InfinityLoader
// creates the Lua state itself and calls `luaL_openlibs` (initLuaState in
// InfinityLoaderDLL/source/InfinityLoaderDLL/infinity_loader_dll.cpp), so every
// library of lib_init.c is open; EEex's EEex_ReplaceLua.lua no longer redirects
// `luaopen_bit32` ("Removed"), and `print` is still the engine's (Override_bootstrapLua).
//
// Sources, each fetched once into .cache/luajit and verified by its SHA-256 before
// every use (files at a fixed commit never change, so the hashes are stable):
//
// - from Bubb13/InfinityLoader at INFINITY_LOADER_COMMIT: LuaJIT/VERSION.TXT (must
//   name LUAJIT_COMMIT), the build script, lj_arch.h, lualib.h, lib_init.c and the
//   lib_*.c files of the libraries (what the build registers; see extract.mts);
// - from LuaJIT/LuaJIT at LUAJIT_COMMIT: the documentation pages served on
//   https://luajit.org/ (extensions.html, ext_buffer.html, ext_jit.html,
//   ext_ffi_api.html) and COPYRIGHT;
// - the `bit.*` functions are documented by Lua BitOp ("LuaJIT supports all bitwise
//   operations as defined by Lua BitOp", extensions.html#bit): doc/api.html of the
//   LuaBitOp tarball from https://bitop.luajit.org/download.html. No checksum is
//   published for it; BITOP_SHA256 is the hash of the release as first downloaded.
//
// The text is kept word for word (scripts/lua-manual/convert.mts, LuaJIT mode); links
// point to the online pages, the URLs plan.md names.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchLuaTarball, readTarballMember, sha256 } from '../../third_party/lua52/tarball.mts';
import {
  extractEntries,
  libraryNames,
  LuaJitFormatError,
  openedLibraries,
  pageInfo,
  registeredNames,
  type Flags,
  type LuaJitEntry,
  type Omission,
  type Page,
  type PageInfo,
} from './extract.mts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const output = join(root, 'data', 'luajit', 'manual.json');
const lua52Data = join(root, 'data', 'lua52', 'manual.json');

export const INFINITY_LOADER = 'Bubb13/InfinityLoader';
/** master on 2026-11-02, when this data was generated. */
export const INFINITY_LOADER_COMMIT = '817925caab3eb9cf600cfaf38853da8d30c28247';
export const LUAJIT = 'LuaJIT/LuaJIT';
/** The commit LuaJIT/VERSION.TXT of INFINITY_LOADER_COMMIT names. */
export const LUAJIT_COMMIT = 'eec7a8016c3381b949b5d84583800d05897fa960';
export const BITOP_URL = 'https://bitop.luajit.org/download/LuaBitOp-1.0.4.tar.gz';
export const BITOP_SHA256 = 'adc32785579fc62f7736881332f70f50fe168b2ae8d0ddb741ff018a76f48c80';
const BITOP_MEMBERS = { api: 'LuaBitOp-1.0.4/doc/api.html', readme: 'LuaBitOp-1.0.4/README' } as const;

interface SourceFile {
  readonly repository: string;
  readonly commit: string;
  readonly path: string;
  readonly sha256: string;
}

const il = (path: string, hash: string): SourceFile => ({ repository: INFINITY_LOADER, commit: INFINITY_LOADER_COMMIT, path: `LuaJIT/${path}`, sha256: hash });
const lj = (path: string, hash: string): SourceFile => ({ repository: LUAJIT, commit: LUAJIT_COMMIT, path, sha256: hash });

export const SOURCES = {
  version: il('VERSION.TXT', '3f2ad964e3c2a032f1461f2c2676c4c428ec48e6ec270c26ca82c5e952fa0112'),
  build: il('src/msvcbuild.bat', '460b925e7eee88daa2303402f055fa4f9f17929c8152efdb0bff6bb4198bb5b1'),
  arch: il('src/lj_arch.h', '454c53cae614cd352a25525a0bc140e7a3641c723ba10fb8fa9844551d6586aa'),
  lualib: il('src/lualib.h', 'd22818eab4c2805990388cc7ac00bddc4e4712bf73bd9509489042526ba94645'),
  libInit: il('src/lib_init.c', '022838806752869fe8009a6e19678d7ce4a625c968725ea675f9bca87d13f20b'),
  libraries: [
    il('src/lib_base.c', '93f1042fc42c2949ac6d780d913b4382f72c32c4272d6fc1aad5cac4daaaa331'),
    il('src/lib_string.c', 'fd15bc97b1aac6bbaf253590a83719c0e642b1aafce021ff8a95c5682b218d60'),
    il('src/lib_table.c', 'af83cc599da6ace66b5156f969bcb3f5e94c9ee4d3164a3a049bd0ed33c13bd4'),
    il('src/lib_math.c', 'ebe4ee4c7aea7220c4b4f4b5e7bf58dde92eac5e4b2c1a15ff6bf12432584a01'),
    il('src/lib_debug.c', '14699b7f927fc42fe92d4d22ce2e9bddfb718c3d5bd514cf97db7a69b7fb9ae5'),
    il('src/lib_bit.c', 'dcaab5792c57534e16ac8dd8e0e015dab44fecc639edfda89249410e848a66f4'),
    il('src/lib_jit.c', 'a5eb37752161d05780363711539492838400a5c831364c1cf3923d3ab8fa3b10'),
    il('src/lib_ffi.c', 'be13959ffb34772ed0f2fae36ca078670f6532cab19ec1ed9941cdda31352c8e'),
    il('src/lib_buffer.c', '2cdd6158b7008165e5b11a381cfeaf1dce6f1fb63afc23b199c44f44d728bf29'),
  ],
  pages: [
    lj('doc/extensions.html', 'bb3be173fb16895dd285edc1bb2d2084f8a22ecb3f2e2700cc6db1a28a6b9ff4'),
    lj('doc/ext_buffer.html', '635c9f22e7c11391b470ddb6d7ce84441d74fa9dd199bed232ec57542bad9344'),
    lj('doc/ext_jit.html', '092ae9a28d7ea7366a8e370f5cc08a92f7f0ac5a98ebab1a592f7e912ea67c2b'),
    lj('doc/ext_ffi_api.html', 'e31a7fdacdd65de6a726d967126ee576e9b531abc8ce7c59784ecc4f915fda57'),
  ],
  copyright: lj('COPYRIGHT', '5b79fb4754728487cf43d55b213bb68369912484f2dd7ab68380435e994bce39'),
} as const;

const LUAJIT_SITE = 'https://luajit.org/';
const BITOP_PAGE = 'https://bitop.luajit.org/api.html';

/**
 * The module tables, which the pages describe in an introduction rather than under a
 * heading of their own: extensions.html "Extensions Modules" for `bit`, `ffi` and
 * `jit`, and the introduction of ext_buffer.html for `string.buffer`.
 */
const MODULES = [
  { name: 'bit', page: 'extensions', section: 'bit' },
  { name: 'ffi', page: 'extensions', section: 'ffi' },
  { name: 'jit', page: 'extensions', section: 'jit' },
  { name: 'string.buffer', page: 'ext_buffer', section: 'intro' },
] as const;

export interface LuaJitData {
  readonly sources: {
    readonly files: readonly SourceFile[];
    readonly bitop: { readonly url: string; readonly sha256: string; readonly member: string };
  };
  /** The copyright lines of LuaJIT (COPYRIGHT) and Lua BitOp (README). */
  readonly copyright: readonly string[];
  readonly pages: readonly PageInfo[];
  /** Libraries `luaL_openlibs` opens as globals, and modules `require` loads without a file. */
  readonly globals: readonly string[];
  readonly preload: readonly string[];
  /** Entries of data/lua52/manual.json that this LuaJIT does not provide. */
  readonly lua52Unavailable: readonly string[];
  readonly omitted: readonly Omission[];
  readonly entries: readonly LuaJitEntry[];
}

const rawUrl = (file: SourceFile): string => `https://raw.githubusercontent.com/${file.repository}/${file.commit}/${file.path}`;

async function read(file: SourceFile): Promise<string> {
  const path = await fetchLuaTarball({
    url: rawUrl(file),
    sha256: file.sha256,
    path: join(root, '.cache', 'luajit', file.repository, file.commit, file.path),
    download: async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Downloading ${url} failed: HTTP ${response.status} ${response.statusText}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  });
  return readFileSync(path, 'utf8');
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new LuaJitFormatError(message);
}

/**
 * The feature flags of EEex's build, from msvcbuild.bat and lj_arch.h. lj_arch.h
 * defines each flag from the build's `LUAJIT_*` options and the target; the rules it
 * uses are checked to still be the ones modeled here.
 */
export function buildFlags(build: string, arch: string): Flags {
  const compile = /^@set LJCOMPILE=cl (.*)$/m.exec(build)?.[1];
  expect(compile !== undefined, `${SOURCES.build.path}: no "@set LJCOMPILE=cl …" line.`);
  const options = new Set([...(compile ?? '').matchAll(/\/D(\w+)/g)].map(([, name = '']) => name));
  // A LUAJIT_DISABLE_* anywhere in the script (even behind an option) is a feature the
  // data does not model, apart from GC64, which changes no library.
  const disabled = [...build.matchAll(/\/DLUAJIT_DISABLE_(\w+)/g)].map(([, name = '']) => name).filter((name) => name !== 'GC64');
  expect(disabled.length === 0, `${SOURCES.build.path}: builds with LUAJIT_DISABLE_${disabled.join(', LUAJIT_DISABLE_')}, which this generator does not model.`);
  const rules = [
    '#if defined(LUAJIT_DISABLE_JIT) || defined(LJ_ARCH_NOJIT) || defined(LJ_OS_NOJIT)\n#define LJ_HASJIT\t\t0',
    '#if defined(LUAJIT_DISABLE_FFI) || defined(LJ_ARCH_NOFFI)\n#define LJ_HASFFI\t\t0',
    '#if defined(LUAJIT_DISABLE_BUFFER)\n#define LJ_HASBUFFER\t\t0',
    '#elif LJ_TARGET_WINDOWS || LJ_TARGET_XBOX360\n#define LJ_HASPROFILE\t\t1',
    '#ifdef LUAJIT_ENABLE_LUA52COMPAT\n#define LJ_52\t\t\t1',
    // The only definitions of LJ_ARCH_NOFFI and LJ_OS_NOJIT are for consoles and iOS, never Windows on x86 or x64.
    '#if LJ_TARGET_CONSOLE\n#define LJ_ARCH_PPC32ON64\t1\n#define LJ_ARCH_NOFFI\t\t1',
    '#if LJ_TARGET_IOS || LJ_TARGET_CONSOLE',
  ];
  for (const rule of rules) expect(arch.includes(rule), `${SOURCES.arch.path} no longer contains:\n${rule}`);
  expect(arch.split('#define LJ_ARCH_NOFFI').length === 2 && arch.split('#define LJ_OS_NOJIT').length === 2, `${SOURCES.arch.path}: LJ_ARCH_NOFFI or LJ_OS_NOJIT is defined more than once.`);
  return {
    LJ_52: options.has('LUAJIT_ENABLE_LUA52COMPAT'),
    LJ_HASJIT: true,
    LJ_HASFFI: true,
    LJ_HASBUFFER: true,
    LJ_HASPROFILE: true,
    LUAJIT_DISABLE_JITUTIL: false,
  };
}

async function generate(): Promise<string> {
  const version = (await read(SOURCES.version)).trim();
  const expected = `https://github.com/${LUAJIT}/tree/${LUAJIT_COMMIT}`;
  expect(version === expected, `${INFINITY_LOADER} ${SOURCES.version.path} reads "${version}", expected "${expected}".`);
  const flags = buildFlags(await read(SOURCES.build), await read(SOURCES.arch));

  const names = libraryNames(await read(SOURCES.lualib));
  const opened = openedLibraries(await read(SOURCES.libInit), names, flags);
  const prereg: [string, string][] = [];
  const registered = new Set<string>();
  for (const file of SOURCES.libraries) {
    for (const name of registeredNames(await read(file), file.path, flags, prereg)) registered.add(name);
  }
  const preload = [
    ...opened.preload,
    ...prereg.map(([macro, rest]) => {
      const library = names.get(macro);
      if (library === undefined) throw new LuaJitFormatError(`lj_lib_prereg uses ${macro}, which lualib.h does not define.`);
      return `${library}.${rest}`;
    }),
  ].sort();
  const registrations = { globals: opened.load, preload, names: [...registered].sort() };

  const lua52 = JSON.parse(readFileSync(lua52Data, 'utf8')) as { entries: { name: string; kind: string }[] };
  const lua52Names = new Set(lua52.entries.map((entry) => entry.name));
  const lua52Unavailable = lua52.entries
    .filter((entry) => (entry.kind === 'module' ? !opened.load.includes(entry.name) : !registered.has(entry.name)))
    .map((entry) => entry.name);

  const tarball = await fetchLuaTarball({
    url: BITOP_URL,
    sha256: BITOP_SHA256,
    path: join(root, '.cache', 'luajit', 'LuaBitOp-1.0.4.tar.gz'),
    download: async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Downloading ${url} failed: HTTP ${response.status} ${response.statusText}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  });
  const pages: Page[] = [];
  for (const file of SOURCES.pages) {
    const name = file.path.replace(/^doc\//, '');
    pages.push({ id: name.replace(/\.html$/, ''), url: new URL(name, LUAJIT_SITE).href, html: await read(file) });
  }
  pages.push({ id: 'bitop_api', url: BITOP_PAGE, html: readTarballMember(tarball, BITOP_MEMBERS.api).toString('utf8') });

  const { entries, omitted } = extractEntries(pages, MODULES, lua52Names, registrations);
  const copyrightLine = (text: string, what: string): string => {
    const line = /^.*Copyright \(C\).*$/m.exec(text)?.[0]?.trim();
    if (line === undefined) throw new LuaJitFormatError(`${what}: no copyright line.`);
    return line;
  };
  const data: LuaJitData = {
    sources: {
      files: [SOURCES.version, SOURCES.build, SOURCES.arch, SOURCES.lualib, SOURCES.libInit, ...SOURCES.libraries, ...SOURCES.pages, SOURCES.copyright],
      bitop: { url: BITOP_URL, sha256: BITOP_SHA256, member: BITOP_MEMBERS.api },
    },
    copyright: [
      copyrightLine(await read(SOURCES.copyright), SOURCES.copyright.path),
      copyrightLine(readTarballMember(tarball, BITOP_MEMBERS.readme).toString('utf8'), BITOP_MEMBERS.readme),
    ],
    pages: pages.map(pageInfo),
    globals: opened.load,
    preload,
    lua52Unavailable,
    omitted,
    entries,
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}

function fail(message: string, file?: string): never {
  // `::error::` renders as an annotation on GitHub Actions and reads fine locally.
  console.error(`::error${file ? ` file=${relative(root, file)},` : ' '}title=LuaJIT manual data::${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  try {
    const fresh = await generate();
    if (process.argv.includes('--check')) {
      if (!existsSync(output)) fail(`${relative(root, output)} is missing. Run \`npm run luajit-manual\` and commit the result.`, output);
      if (readFileSync(output, 'utf8') !== fresh) {
        fail(`${relative(root, output)} does not match the data generated from the pinned LuaJIT sources. Run \`npm run luajit-manual\` and commit the result.`, output);
      }
      console.log(`${relative(root, output)} matches the data generated from ${LUAJIT}@${LUAJIT_COMMIT.slice(0, 12)} and ${INFINITY_LOADER}@${INFINITY_LOADER_COMMIT.slice(0, 12)}.`);
      return;
    }
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, fresh);
    console.log(`Wrote ${relative(root, output)}.`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

// Run only as a script, not when the tests import it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

export { sha256 };
