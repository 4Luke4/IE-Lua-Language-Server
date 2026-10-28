import createLua52, { type Lua52Module } from '../../../third_party/lua52/dist/lua52.js';
import { CHUNK_NAME } from './luaError.ts';

/** Syntax checker backed by the official Lua 5.2.4 compiler (WebAssembly). */
export interface Lua52Checker {
  /** Returns `undefined` when `source` compiles, otherwise the raw compiler message. */
  check(source: string): string | undefined;
}

const encoder = new TextEncoder();

/** Instantiates the WebAssembly module. Call once and reuse the checker. */
export async function loadLua52(): Promise<Lua52Checker> {
  const wasm: Lua52Module = await createLua52();
  const chunkName = encoder.encode(`${CHUNK_NAME}\0`);
  const chunkNamePointer = wasm._malloc(chunkName.length);
  wasm.HEAPU8.set(chunkName, chunkNamePointer);
  return {
    check(source: string): string | undefined {
      const bytes = encoder.encode(source);
      // malloc(0) may return NULL; always allocate at least one byte.
      const pointer = wasm._malloc(Math.max(1, bytes.length));
      if (pointer === 0) {
        throw new Error(`Lua 5.2 WebAssembly module could not allocate ${bytes.length} bytes.`);
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
