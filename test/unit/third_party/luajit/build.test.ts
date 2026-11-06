import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { makefileTarget, msvcDefines, msvcLibraries } from '../../../../third_party/luajit/build.mts';

// Lines as in the pinned src/msvcbuild.bat of Bubb13/InfinityLoader.
const MSVC = [
  '@rem @set LJCOMPILE=cl /nologo /c /O2 /W3 /D_CRT_SECURE_NO_DEPRECATE /D_CRT_STDIO_INLINE=__declspec(dllexport)__inline',
  '@set LJCOMPILE=cl /nologo /c /O2 /W3 /D_CRT_SECURE_NO_DEPRECATE /D_CRT_STDIO_INLINE=__declspec(dllexport)__inline /DLUAJIT_ENABLE_LUA52COMPAT',
  '@set ALL_LIB=lib_base.c lib_math.c lib_bit.c lib_string.c lib_table.c lib_io.c lib_os.c lib_package.c lib_debug.c lib_jit.c lib_ffi.c lib_buffer.c',
].join('\r\n');

/** Macros as `emcc -E -dM lj_arch.h` prints them for this build's target options. */
const X86: ReadonlyMap<string, string> = new Map([
  ['LJ_TARGET_X86', '1'],
  ['LJ_LE', '1'],
  ['LJ_ARCH_BITS', '32'],
  ['LJ_HASJIT', '0'],
  ['LJ_HASFFI', '1'],
  ['LJ_DUALNUM', '0'],
  ['LJ_ARCH_HASFPU', '1'],
  ['LJ_ABI_SOFTFP', '0'],
  ['LJ_ABI_PAUTH', '0'],
  ['LJ_UNWIND_EXT', '0'],
]);

const BUILD = new URL('../../../../third_party/luajit/build.mts', import.meta.url).href;

/**
 * The child process of `exitsWith`. A fixed script: the module, the function and its
 * argument arrive as data in argv (JSON), never as code.
 */
const CHILD = `
const [module, name, json] = process.argv.slice(1);
const build = await import(module);
const argument = JSON.parse(json);
if (name === 'msvcDefines') build.msvcDefines(argument);
else if (name === 'makefileTarget') build.makefileTarget(new Map(argument));
else throw new Error('unknown function ' + name);
`;

/** Calls a build.mts helper in a child process: the build reports failures by exiting. */
function exitsWith(
  ...[name, argument]: ['msvcDefines', string] | ['makefileTarget', [string, string][]]
): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD, '--', BUILD, name, JSON.stringify(argument)], { encoding: 'utf8' });
  return { status: result.status, stderr: result.stderr };
}

describe('third_party/luajit/build', () => {
  describe('msvcDefines', () => {
    it("carries over the uncommented LJCOMPILE line's LUAJIT_ defines and drops MSVC runtime ones", () => {
      assert.deepEqual(msvcDefines(MSVC), ['-DLUAJIT_ENABLE_LUA52COMPAT']);
    });

    it('stops on a define it does not know how to carry over', () => {
      const { status, stderr } = exitsWith('msvcDefines', '@set LJCOMPILE=cl /DLUA_USE_ASSERT');
      assert.equal(status, 1);
      assert.match(stderr, /::error title=LuaJIT WASM build::src\/msvcbuild\.bat compiles with \/DLUA_USE_ASSERT, which this build does not know how to carry over\./);
    });

    it('stops when there is no LJCOMPILE line', () => {
      const { status, stderr } = exitsWith('msvcDefines', '@rem nothing');
      assert.equal(status, 1);
      assert.match(stderr, /no "@set LJCOMPILE=cl …" line/);
    });
  });

  it('reads the library sources buildvm is given', () => {
    assert.deepEqual(msvcLibraries(MSVC), [
      'lib_base.c', 'lib_math.c', 'lib_bit.c', 'lib_string.c', 'lib_table.c', 'lib_io.c',
      'lib_os.c', 'lib_package.c', 'lib_debug.c', 'lib_jit.c', 'lib_ffi.c', 'lib_buffer.c',
    ]);
  });

  describe('makefileTarget', () => {
    it('derives the DynASM flags and TARGET_ARCH as src/Makefile does', () => {
      assert.deepEqual(makefileTarget(X86), {
        dasc: 'vm_x86.dasc',
        dasmFlags: ['-D', 'ENDIAN_LE', '-D', 'FFI', '-D', 'FPU', '-D', 'HFABI', '-D', 'VER='],
        targetArch: ['-DLJ_ARCH_HASFPU=1', '-DLJ_ABI_SOFTFP=0'],
      });
    });

    it('stops when lj_arch.h selects external unwinding, which validate.c does not implement', () => {
      const { status, stderr } = exitsWith('makefileTarget', [...X86, ['LJ_UNWIND_EXT', '1']]);
      assert.equal(status, 1);
      assert.match(stderr, /selected external unwinding/);
    });

    it('stops when lj_arch.h selects another target', () => {
      const { status, stderr } = exitsWith('makefileTarget', [...X86, ['LJ_TARGET_X64', '1']]);
      assert.equal(status, 1);
      assert.match(stderr, /did not select the x86 target/);
    });
  });
});
