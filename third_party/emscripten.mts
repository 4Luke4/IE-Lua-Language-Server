// The Emscripten release both WebAssembly modules are built with (third_party/lua52/,
// third_party/luajit/). A https://github.com/emscripten-core/emsdk tag; CI reads it
// from this line, so keep the declaration on one line.
export const EMSCRIPTEN_VERSION = '6.0.13';

/** `true` when the first line of `emcc --version` names EMSCRIPTEN_VERSION. */
export function isPinnedEmcc(versionLine: string): boolean {
  // The line looks like: "emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 6.0.13 (<hash>)"
  return new RegExp(`\\) ${EMSCRIPTEN_VERSION.replaceAll('.', '\\.')} \\(`).test(versionLine);
}
