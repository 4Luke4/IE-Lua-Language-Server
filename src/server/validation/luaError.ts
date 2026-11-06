import type { LuaDialect } from './checker.ts';

/** Chunk name passed to the compiler; messages then start with `chunk:<line>:`. */
export const CHUNK_NAME = '=chunk';

export interface LuaSyntaxError {
  /** 1-based line inside the compiled text. */
  readonly line: number;
  /** The message without the `chunk:<line>: ` prefix, exactly as the compiler wrote it. */
  readonly message: string;
  /** Token text from a trailing `near '<token>'`, if any. */
  readonly nearToken?: string;
  /** `true` when the message says the error is at the end of the chunk. */
  readonly atEof: boolean;
}

// Both front ends prefix the message with "<chunkname>:<line>: " (Lua 5.2 ldebug.c
// `luaG_addinfo`; LuaJIT lj_err.c `lj_err_lex`).
const PREFIX = /^chunk:(\d+): ([\s\S]*)$/;
const NEAR_TOKEN = / near '([\s\S]*)'$/;

/**
 * How each front end names the end of the chunk:
 *
 * - Lua 5.2 (llex.c `lexerror` + `txtToken`): "%s near %s"; reserved-word-like tokens
 *   from `TK_EOS` on are not quoted, so the end of the chunk reads `near <eof>`.
 * - LuaJIT (lj_err.c `lj_err_lex`, `LJ_ERR_XNEAR` = "%s near " LUA_QS): every token is
 *   quoted, so it reads `near '<eof>'`. No other LuaJIT token text can be `<eof>`: the
 *   text of names, strings and numbers is their source, which cannot spell it.
 */
const NEAR_EOF: Readonly<Record<LuaDialect, RegExp>> = {
  lua52: / near <eof>$/,
  luajit: / near '<eof>'$/,
};

/** Parses a compiler message of `dialect`. Returns `undefined` for an unexpected shape. */
export function parseLuaError(raw: string, dialect: LuaDialect): LuaSyntaxError | undefined {
  const match = PREFIX.exec(raw);
  if (!match?.[1] || match[2] === undefined) {
    return undefined;
  }
  const line = Number(match[1]);
  const message = match[2];
  if (NEAR_EOF[dialect].test(message)) {
    return { line, message, atEof: true };
  }
  const near = NEAR_TOKEN.exec(message);
  if (near?.[1] !== undefined) {
    return { line, message, nearToken: near[1], atEof: false };
  }
  return { line, message, atEof: false };
}
