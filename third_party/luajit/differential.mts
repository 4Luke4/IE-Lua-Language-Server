// Checks that the WebAssembly module (dist/luajit.js) parses exactly like a native LuaJIT
// built from the same pinned sources.
//
//   npm run luajit-differential
//
// Builds LuaJIT natively from the pinned tree (source.mts) with its own src/Makefile,
// with the /D options of msvcbuild.bat, as EEex builds it. On an x64 host that is a GC64
// build with two-slot frames, like EEex's (Windows x64): the parser does not depend on
// the operating system. Needs git, make and a C compiler; CI runs it on ubuntu-latest.
//
// Every chunk (the files of test/fixtures/luajit-syntax/ and the boundary cases below)
// is loaded by both with chunk name "=chunk" and mode "t". The answers, "OK" or the
// message, must be identical. Each difference is reported with both answers.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { availableParallelism, arch, tmpdir } from 'node:os';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import createLuaJit from './dist/luajit.js';
import { msvcDefines } from './build.mts';
import { LUAJIT_SUBTREE, writeLuaJitSource } from './source.mts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const corpus = join(root, 'test', 'fixtures', 'luajit-syntax');

function fail(message: string): never {
  console.error(`::error title=LuaJIT differential::${message}`);
  process.exit(1);
}

const repeat = (n: number, text: string, separator = ''): string => Array.from({ length: n }, () => text).join(separator);

/**
 * Register and nesting limits on both sides of each boundary: where they lie depends on
 * the frame layout (validate.c, load mode "X") and on LJ_MAX_* in lj_def.h.
 */
function generated(): Map<string, string> {
  const cases = new Map<string, string>();
  for (const n of [246, 247, 248, 249]) cases.set(`call with ${String(n)} arguments`, `f(${repeat(n, '1', ',')})`);
  for (const n of [81, 82, 83, 84]) cases.set(`calls nested ${String(n)} deep`, `f(${repeat(n, '1, f(')}1${repeat(n + 1, ')')}`);
  for (const n of [81, 82, 83, 84]) cases.set(`method calls nested ${String(n)} deep`, `o:m(${repeat(n, '1, o:m(')}1${repeat(n + 1, ')')}`);
  for (const n of [199, 200, 201]) cases.set(`${String(n)} locals`, `local ${Array.from({ length: n }, (_, i) => `v${String(i)}`).join(', ')}\n`);
  for (const n of [59, 60, 61]) {
    const locals = `local ${Array.from({ length: n }, (_, i) => `u${String(i)}`).join(', ')}`;
    const uses = Array.from({ length: n }, (_, i) => `u${String(i)}`).join(' + ');
    cases.set(`${String(n)} upvalues`, `${locals}\nreturn function() return ${uses} end\n`);
  }
  for (const n of [198, 199, 200, 201]) cases.set(`${String(n)} nested parentheses`, `x = ${repeat(n, '(')}1${repeat(n, ')')}`);
  for (const n of [198, 199, 200]) cases.set(`${String(n)} nested blocks`, `${repeat(n, 'do ')}${repeat(n, 'end ')}`);
  cases.set('bytecode', '\x1bLJ\x02\x00');
  cases.set('empty chunk', '');
  cases.set('NUL in a string', 'return "a\0b"');
  return cases;
}

function run(command: string, args: readonly string[], cwd: string): void {
  try {
    execFileSync(command, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error && Buffer.isBuffer(error.stderr) ? error.stderr.toString('utf8').trim() : '';
    fail(`\`${command} ${args.join(' ')}\` failed in ${cwd}:\n${stderr || (error instanceof Error ? error.message : String(error))}`);
  }
}

/** Loads stdin as "=chunk" in mode "t" and writes "OK" or the message. */
const NATIVE_SCRIPT = 'local f, e = load(io.read("*a"), "=chunk", "t") io.write(f and "OK" or e)';

async function main(): Promise<void> {
  if (arch() !== 'x64') fail(`The native build must have two-slot frames like EEex's x64 build; this host is ${arch()}.`);
  const work = mkdtempSync(join(tmpdir(), 'luajit-native-'));
  try {
    const tree = join(work, LUAJIT_SUBTREE);
    try {
      writeLuaJitSource(tree);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    const defines = msvcDefines(readFileSync(join(tree, 'src', 'msvcbuild.bat'), 'utf8'));
    run('make', ['-C', 'src', `-j${String(availableParallelism())}`, `XCFLAGS=${defines.join(' ')}`, 'luajit'], tree);
    const native = join(tree, 'src', 'luajit');
    // The native build's own frame layout: lj_bcwrite.c sets BCDUMP_F_FR2 (0x08, lj_bcdump.h)
    // in the fifth byte of a dump, after "\x1bLJ" and the version, when frames take two slots.
    const layout = spawnSync(native, ['-e', 'io.write(math.floor(string.dump(function() end):byte(5) / 8) % 2)'], { encoding: 'utf8' });
    if (layout.status !== 0) fail(`Running ${native} failed: ${layout.stderr}`);
    if (layout.stdout !== '1') fail(`${native} does not lay out frames in two slots (BCDUMP_F_FR2 unset), unlike EEex's x64 build.`);

    const wasm = await createLuaJit();
    const encoder = new TextEncoder();
    const name = encoder.encode('=chunk\0');
    const namePointer = wasm._malloc(name.length);
    wasm.HEAPU8.set(name, namePointer);
    const viaWasm = (source: Buffer): string => {
      const pointer = wasm._malloc(Math.max(1, source.length));
      wasm.HEAPU8.set(source, pointer);
      const result = wasm._ie_validate(pointer, source.length, namePointer);
      wasm._free(pointer);
      return result === 0 ? 'OK' : wasm.UTF8ToString(result);
    };
    const viaNative = (source: Buffer): string => {
      const result = spawnSync(native, ['-e', NATIVE_SCRIPT], { input: source, encoding: 'buffer' });
      if (result.status !== 0) fail(`${native} exited with ${String(result.status)}: ${result.stderr.toString('utf8')}`);
      return result.stdout.toString('utf8');
    };

    const chunks: [string, Buffer][] = [
      ...readdirSync(corpus).filter((file) => file.endsWith('.lua')).sort().map((file): [string, Buffer] => [relative(root, join(corpus, file)), readFileSync(join(corpus, file))]),
      ...[...generated()].map(([label, text]): [string, Buffer] => [label, Buffer.from(text, 'utf8')]),
    ];
    let differences = 0;
    for (const [label, source] of chunks) {
      const expected = viaNative(source);
      const actual = viaWasm(source);
      if (expected === actual) {
        console.log(`same  ${label}: ${expected}`);
      } else {
        differences++;
        console.error(`::error title=LuaJIT differential::${label}: native x64 LuaJIT says ${JSON.stringify(expected)}, the WebAssembly module says ${JSON.stringify(actual)}.`);
      }
    }
    if (differences > 0) {
      fail(`${String(differences)} of ${String(chunks.length)} chunks differ. third_party/luajit/validate.c or build.mts no longer builds what EEex runs.`);
    }
    console.log(`All ${String(chunks.length)} chunks parse identically with native x64 LuaJIT and the WebAssembly module.`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

await main();
