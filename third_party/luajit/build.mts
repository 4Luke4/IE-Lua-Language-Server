// Reproducibly builds LuaJIT's lexer and parser, as EEex installs them, to WebAssembly.
//
//   npm run build:wasm:luajit             rebuild third_party/luajit/dist/*
//   npm run build:wasm:luajit -- --check  rebuild into a temp dir; fail if it differs from dist/
//
// Requires Emscripten (EMSCRIPTEN_VERSION in ../emscripten.mts) and git on PATH. Inputs
// are pinned and verified: the sources by their git tree hash (source.mts), the
// compiler by its exact version string.
//
// The build follows LuaJIT's own (src/Makefile, and src/msvcbuild.bat, which EEex runs):
//
// 1. Host tools. minilua generates luajit.h (host/genversion.lua) and runs DynASM on
//    vm_x86.dasc for host/buildvm_arch.h; buildvm generates the lj_*def.h headers. The
//    tools are compiled by emcc too and run by Node, so no host C compiler is needed.
// 2. Every lj_*.c and lib_*.c, unchanged, as msvcbuild.bat compiles them, with its
//    LJCOMPILE defines (LUAJIT_ENABLE_LUA52COMPAT), plus validate.c. validate.c stands
//    in for lj_vm.obj, the interpreter that buildvm generates as machine code, which has
//    no WebAssembly target; see its header. The linker drops what loading never reaches.
//
// Target options, beyond msvcbuild.bat's:
// - LUAJIT_TARGET=LUAJIT_ARCH_X86: lj_arch.h only knows CPU targets; x86 is 32-bit and
//   little-endian, like wasm32. The parser lays out frames as x64 GC64 does all the same
//   (load mode "X", see validate.c).
// - LUAJIT_DISABLE_JIT: there is no machine code to generate. lj_lex.c, lj_parse.c and
//   lj_load.c do not depend on LJ_HASJIT.
// - LUAJIT_SECURITY_PRNG=0: the target has no entropy source lj_prng.c knows; its
//   comment says to define this then. The seed only affects code that runs.
// LJ_ARCH_HASFPU and LJ_ABI_SOFTFP are passed as src/Makefile derives them (TARGET_ARCH).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../lua52/tarball.mts';
import { EMSCRIPTEN_VERSION, isPinnedEmcc } from '../emscripten.mts';
import { LUAJIT_SUBTREE, writeLuaJitSource } from './source.mts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

const TARGET_DEFINES = ['-DLUAJIT_TARGET=LUAJIT_ARCH_X86', '-DLUAJIT_DISABLE_JIT', '-DLUAJIT_SECURITY_PRNG=0'];
// Same optimization and warnings as lua52/build.mts and src/Makefile (CCOPT, CCWARN).
const CFLAGS = ['-O2', '-Wall'];
const HOST_LINK = ['-sNODERAWFS=1', '-sENVIRONMENT=node', '-sALLOW_MEMORY_GROWTH=1', '-sEXIT_RUNTIME=1'];

function fail(message: string): never {
  // `::error::` renders as an annotation on GitHub Actions and reads fine locally.
  console.error(`::error title=LuaJIT WASM build::${message}`);
  process.exit(1);
}

function run(command: string, args: readonly string[], cwd: string): string {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      fail(
        command === 'emcc'
          ? `\`emcc\` was not found on PATH. Install Emscripten ${EMSCRIPTEN_VERSION} and run \`source .cache/emsdk/emsdk_env.sh\` first (CONTRIBUTING.md › The LuaJIT WebAssembly module).`
          : `\`${command}\` was not found on PATH.`,
      );
    }
    const stderr = error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
    const details = stderr || (error instanceof Error ? error.message : String(error));
    fail(`\`${command} ${args.join(' ')}\` failed in ${cwd}:\n${details}`);
  }
}

function checkCompiler(): void {
  const version = run('emcc', ['--version'], root).split('\n')[0] ?? '';
  if (!isPinnedEmcc(version)) {
    fail(`Emscripten ${EMSCRIPTEN_VERSION} is required, found: "${version}". See CONTRIBUTING.md › The LuaJIT WebAssembly module.`);
  }
}

/** The build's `/D` options, from `@set LJCOMPILE=cl …` of src/msvcbuild.bat. */
export function msvcDefines(script: string): string[] {
  const line = /^@set LJCOMPILE=cl (.*)$/m.exec(script)?.[1];
  if (line === undefined) fail('src/msvcbuild.bat: no "@set LJCOMPILE=cl …" line.');
  const defines: string[] = [];
  for (const [, define = ''] of line.matchAll(/\/D(\S+)/g)) {
    // _CRT_*: Microsoft C runtime options, meaningless outside MSVC.
    if (define.startsWith('_CRT_')) continue;
    if (!/^LUAJIT_\w+$/.test(define)) {
      fail(`src/msvcbuild.bat compiles with /D${define}, which this build does not know how to carry over.`);
    }
    defines.push(`-D${define}`);
  }
  return defines;
}

/** `@set ALL_LIB=…` of src/msvcbuild.bat: the library sources buildvm reads. */
export function msvcLibraries(script: string): string[] {
  const line = /^@set ALL_LIB=(.*)$/m.exec(script)?.[1];
  if (line === undefined) fail('src/msvcbuild.bat: no "@set ALL_LIB=…" line.');
  return line.trim().split(/\s+/);
}

/** The macros `emcc -E -dM lj_arch.h` defines, as src/Makefile reads TARGET_TESTARCH. */
function testArch(src: string, flags: readonly string[]): Map<string, string> {
  const macros = new Map<string, string>();
  for (const line of run('emcc', [...flags, '-E', '-dM', 'lj_arch.h'], src).split('\n')) {
    const match = /^#define (\w+)(?: (.*))?$/.exec(line);
    if (match?.[1]) macros.set(match[1], match[2] ?? '');
  }
  return macros;
}

/**
 * DASM_AFLAGS and TARGET_ARCH as src/Makefile derives them from TARGET_TESTARCH, for
 * this target. Anything the Makefile would treat differently stops the build.
 */
export function makefileTarget(arch: ReadonlyMap<string, string>): { dasc: string; dasmFlags: string[]; targetArch: string[] } {
  const is = (name: string, value: string): boolean => arch.get(name) === value;
  if (!is('LJ_TARGET_X86', '1') || arch.has('LJ_TARGET_X64')) fail('lj_arch.h did not select the x86 target.');
  if (!is('LJ_LE', '1')) fail('lj_arch.h did not select a little-endian target.');
  const dasmFlags = ['-D', 'ENDIAN_LE'];
  const targetArch: string[] = [];
  if (is('LJ_ARCH_BITS', '64')) dasmFlags.push('-D', 'P64');
  if (is('LJ_HASJIT', '1')) dasmFlags.push('-D', 'JIT');
  if (is('LJ_HASFFI', '1')) dasmFlags.push('-D', 'FFI');
  if (is('LJ_DUALNUM', '1')) dasmFlags.push('-D', 'DUALNUM');
  if (is('LJ_ARCH_HASFPU', '1')) {
    dasmFlags.push('-D', 'FPU');
    targetArch.push('-DLJ_ARCH_HASFPU=1');
  } else {
    targetArch.push('-DLJ_ARCH_HASFPU=0');
  }
  if (!is('LJ_ABI_SOFTFP', '1')) {
    dasmFlags.push('-D', 'HFABI');
    targetArch.push('-DLJ_ABI_SOFTFP=0');
  } else {
    targetArch.push('-DLJ_ABI_SOFTFP=1');
  }
  if (is('LJ_NO_UNWIND', '1')) {
    dasmFlags.push('-D', 'NO_UNWIND');
    targetArch.push('-DLUAJIT_NO_UNWIND');
  }
  if (is('LJ_ABI_PAUTH', '1')) fail('lj_arch.h selected pointer authentication, which x86 does not have.');
  dasmFlags.push('-D', `VER=${arch.get('LJ_ARCH_VERSION') ?? ''}`);
  // The internal unwinder is what validate.c implements (lj_vm_unwind_c).
  if (!is('LJ_UNWIND_EXT', '0')) fail('lj_arch.h selected external unwinding; validate.c implements the internal one.');
  return { dasc: 'vm_x86.dasc', dasmFlags, targetArch };
}

const DECLARATIONS = `// Generated by third_party/luajit/build.mts — do not edit.
export interface LuaJitModule {
  /** Returns 0 (NULL) when the chunk is valid, otherwise a pointer to the parser message. */
  _ie_validate(source: number, length: number, chunkname: number): number;
  _malloc(size: number): number;
  _free(pointer: number): void;
  HEAPU8: Uint8Array;
  UTF8ToString(pointer: number): string;
}
declare function createLuaJit(): Promise<LuaJitModule>;
export default createLuaJit;
`;

const OUTPUTS = ['luajit.js', 'luajit.d.ts', 'luajit.js.sha256', 'COPYRIGHT'] as const;

function build(outDir: string): void {
  const work = mkdtempSync(join(tmpdir(), 'luajit-'));
  try {
    const tree = join(work, LUAJIT_SUBTREE);
    try {
      writeLuaJitSource(tree);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    const src = join(tree, 'src');
    const node = process.execPath;
    // Strip the random temp path so the output is byte-for-byte reproducible.
    const prefixMap = `-ffile-prefix-map=${work}=.`;
    const msvc = readFileSync(join(src, 'msvcbuild.bat'), 'utf8');
    const options = [...msvcDefines(msvc), ...TARGET_DEFINES];
    const { dasc, dasmFlags, targetArch } = makefileTarget(testArch(src, [...CFLAGS, ...options]));
    const flags = [...CFLAGS, prefixMap, ...options, ...targetArch];

    // 1. Host tools (src/Makefile: MINILUA_T, luajit.h, host/buildvm_arch.h, BUILDVM_T).
    run('emcc', [...CFLAGS, prefixMap, ...HOST_LINK, 'host/minilua.c', '-lm', '-o', 'host/minilua.js'], src);
    // GIT_RELVER: without ../.git (a vendored copy), the Makefile copies ../.relver.
    copyFileSync(join(tree, '.relver'), join(src, 'luajit_relver.txt'));
    run(node, ['host/minilua.js', 'host/genversion.lua'], src);
    run(node, ['host/minilua.js', '../dynasm/dynasm.lua', ...dasmFlags, '-o', 'host/buildvm_arch.h', dasc], src);
    const buildvm = readdirSync(join(src, 'host')).filter((name) => /^buildvm.*\.c$/.test(name)).sort().map((name) => `host/${name}`);
    run('emcc', [...flags, ...HOST_LINK, '-I.', '-I../dynasm', ...buildvm, '-o', 'host/buildvm.js'], src);
    const libraries = msvcLibraries(msvc);
    for (const mode of ['bcdef', 'ffdef', 'libdef', 'recdef']) {
      run(node, ['host/buildvm.js', '-m', mode, '-o', `lj_${mode}.h`, ...libraries], src);
    }
    run(node, ['host/buildvm.js', '-m', 'folddef', '-o', 'lj_folddef.h', 'lj_opt_fold.c'], src);

    // 2. The front end: every lj_*.c and lib_*.c (msvcbuild.bat), and validate.c.
    const sources = readdirSync(src).filter((name) => /^(lj|lib)_\w+\.c$/.test(name)).sort();
    copyFileSync(join(here, 'validate.c'), join(src, 'ie_validate.c'));
    mkdirSync(outDir, { recursive: true });
    run('emcc', [
      ...flags,
      ...sources,
      'ie_validate.c',
      '-sERROR_ON_UNDEFINED_SYMBOLS=1',
      '-sMODULARIZE=1',
      '-sEXPORT_NAME=createLuaJit',
      '-sSINGLE_FILE=1',
      '-sENVIRONMENT=node',
      '-sFILESYSTEM=0',
      '-sALLOW_MEMORY_GROWTH=1',
      '-sEXPORTED_FUNCTIONS=_ie_validate,_malloc,_free',
      '-sEXPORTED_RUNTIME_METHODS=UTF8ToString,HEAPU8',
      '-o', join(outDir, 'luajit.js'),
    ], src);
    writeFileSync(join(outDir, 'luajit.d.ts'), DECLARATIONS);
    const digest = sha256(readFileSync(join(outDir, 'luajit.js')));
    writeFileSync(join(outDir, 'luajit.js.sha256'), `${digest}  luajit.js\n`);
    // The license of what is compiled in, for THIRD_PARTY_NOTICES.md.
    copyFileSync(join(tree, 'COPYRIGHT'), join(outDir, 'COPYRIGHT'));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main(): void {
  const check = process.argv.includes('--check');
  checkCompiler();
  const committed = join(here, 'dist');
  if (!check) {
    build(committed);
    console.log(`Built ${relative(root, join(committed, 'luajit.js'))} (${readFileSync(join(committed, 'luajit.js.sha256'), 'utf8').trim()})`);
    return;
  }
  const scratch = mkdtempSync(join(tmpdir(), 'luajit-check-'));
  try {
    build(scratch);
    for (const file of OUTPUTS) {
      const expectedPath = join(committed, file);
      if (!existsSync(expectedPath)) {
        fail(`${relative(root, expectedPath)} is missing. Run \`npm run build:wasm:luajit\` and commit the result.`);
      }
      const expected = readFileSync(expectedPath);
      const actual = readFileSync(join(scratch, file));
      if (!expected.equals(actual)) {
        fail(
          `${relative(root, expectedPath)} is not reproducible: committed SHA-256 ${sha256(expected)}, ` +
            `fresh build ${sha256(actual)}. Rebuild with \`npm run build:wasm:luajit\` (Emscripten ${EMSCRIPTEN_VERSION}) and commit.`,
        );
      }
    }
    console.log('third_party/luajit/dist matches a fresh build byte for byte.');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// Run only as a script, not when the tests import it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
