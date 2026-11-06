import createLuaJit, { type LuaJitModule } from '../../../third_party/luajit/dist/luajit.js';
import type { LuaChecker } from './checker.ts';
import { CHUNK_NAME } from './luaError.ts';

const encoder = new TextEncoder();

/**
 * Instantiates LuaJIT's lexer and parser as EEex builds them (WebAssembly; see
 * third_party/luajit/). Call once and reuse the checker.
 */
export async function loadLuaJit(): Promise<LuaChecker> {
  const wasm: LuaJitModule = await createLuaJit();
  const chunkName = encoder.encode(`${CHUNK_NAME}\0`);
  const chunkNamePointer = wasm._malloc(chunkName.length);
  wasm.HEAPU8.set(chunkName, chunkNamePointer);
  return {
    dialect: 'luajit',
    check(source: string): string | undefined {
      const bytes = encoder.encode(source);
      // malloc(0) may return NULL; always allocate at least one byte.
      const pointer = wasm._malloc(Math.max(1, bytes.length));
      if (pointer === 0) {
        throw new Error(`LuaJIT WebAssembly module could not allocate ${bytes.length} bytes.`);
      }
      try {
        // Read HEAPU8 after malloc: memory growth replaces the underlying buffer.
        wasm.HEAPU8.set(bytes, pointer);
        const result = wasm._ie_validate(pointer, bytes.length, chunkNamePointer);
        return result === 0 ? undefined : wasm.UTF8ToString(result);
      } finally {
        wasm._free(pointer);
      }
    },
  };
}
