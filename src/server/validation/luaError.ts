/** Chunk name passed to the compiler; messages then start with `chunk:<line>:`. */
export const CHUNK_NAME = '=chunk';

export interface LuaSyntaxError {
  /** 1-based line inside the compiled text. */
  readonly line: number;
  /** The message without the `chunk:<line>: ` prefix, exactly as Lua wrote it. */
  readonly message: string;
  /** Token text from a trailing `near '<token>'`, if any. */
  readonly nearToken?: string;
  /** `true` when the message ends with `near <eof>`. */
  readonly atEof: boolean;
}

const PREFIX = /^chunk:(\d+): ([\s\S]*)$/;
// llex.c `lexerror`: "%s near %s", where the token is quoted with LUA_QS ('%s')
// or is the literal <eof>.
const NEAR_TOKEN = / near '([\s\S]*)'$/;
const NEAR_EOF = / near <eof>$/;

/** Parses a Lua 5.2 compiler message. Returns `undefined` for an unexpected shape. */
export function parseLuaError(raw: string): LuaSyntaxError | undefined {
  const match = PREFIX.exec(raw);
  if (!match?.[1] || match[2] === undefined) {
    return undefined;
  }
  const line = Number(match[1]);
  const message = match[2];
  const near = NEAR_TOKEN.exec(message);
  if (near?.[1] !== undefined) {
    return { line, message, nearToken: near[1], atEof: false };
  }
  return { line, message, atEof: NEAR_EOF.test(message) };
}
