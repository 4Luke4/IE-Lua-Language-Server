import type { Runtime } from '../../shared/settings.ts';

/**
 * The compiler whose front end checks the syntax of a chunk, one per `ieLua.runtime.lua`:
 *
 * - `lua52`: the official Lua 5.2.4 compiler (third_party/lua52/), the game's own Lua;
 * - `luajit`: LuaJIT's lexer and parser (third_party/luajit/), as built by EEex's
 *   "Use LuaJIT" component.
 *
 * The two word their messages differently (luaError.ts), so a checker says which it is.
 */
export type LuaDialect = Runtime;

/** Syntax checker backed by an official Lua front end compiled to WebAssembly. */
export interface LuaChecker {
  readonly dialect: LuaDialect;
  /** Returns `undefined` when `source` compiles, otherwise the raw compiler message. */
  check(source: string): string | undefined;
}
