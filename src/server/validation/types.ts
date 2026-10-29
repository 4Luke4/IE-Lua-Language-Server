// Plain data types for the validation pipeline. No LSP or `vscode` imports, so
// everything under src/server/validation/ can be unit-tested in plain Node.

/** A region of a document that holds Lua source. */
export interface LuaChunk {
  /**
   * `statements`: a full chunk (a `.lua` file, a `` `…` `` block, an `action "…"` script).
   * `expression`: a value the engine evaluates (`enabled "…"`, `<property> lua "…"`).
   */
  readonly kind: 'statements' | 'expression';
  /**
   * Where the chunk comes from: a whole `.lua` file (`file`), a `` `…` `` block of
   * a .menu file (`block`), or a `"…"` property value of a .menu file (`property`).
   */
  readonly origin: 'file' | 'block' | 'property';
  /** Offset of the first character of the Lua text in the document. */
  readonly offset: number;
  /**
   * Half-open document range the chunk comes from, delimiters included (the
   * backticks of a block, the quotes of a string). Equal to the text's range for
   * a file or an unquoted word, which have none.
   */
  readonly region: { readonly start: number; readonly end: number };
  /** The Lua text exactly as it appears in the document. */
  readonly text: string;
  /**
   * How the engine compiles the text: once per form, as `prefix + text + suffix`.
   * Neither part contains a line break, so compiler line numbers are chunk lines.
   */
  readonly forms: readonly CompiledForm[];
}

/** Text the engine puts around a chunk before compiling it. */
export interface CompiledForm {
  readonly prefix: string;
  readonly suffix: string;
}

// The shapes in which the engine compiles .menu property code, from IESDP, "MENU
// file format", section "How a menu becomes Lua"
// (https://gibberlings3.github.io/iesdp/file_formats/ie_formats/menu_v1.htm, commit 38e7532):
//
//   function <prefix><address> () <code> end          -- statement form
//   function <prefix><address> () return <code> end   -- expression form
//
// The engine's function name is a property-specific prefix followed by a memory
// address; any Lua name gives the same syntax, so `f` stands in for it.

/** A whole `.lua` file or a `` `…` `` block, compiled as it is. */
export const CHUNK_FORM: CompiledForm = { prefix: '', suffix: '' };
/** Property code compiled as a function body (`action "…"`, `onOpen "…"`, …). */
export const STATEMENT_FORM: CompiledForm = { prefix: 'function f () ', suffix: ' end' };
/** Property code compiled as a returned expression (`enabled "…"`, `lua "…"`, …). */
export const EXPRESSION_FORM: CompiledForm = { prefix: 'function f () return ', suffix: ' end' };

/** Stable diagnostic codes. Never rename one: users may filter or suppress them. */
export const DiagnosticCode = {
  /** Reported by the official Lua 5.2.4 compiler. */
  LuaSyntax: 'lua-syntax',
  /** A `` ` `` Lua block in a .menu file is never closed. */
  MenuUnterminatedBlock: 'menu-unterminated-block',
  /** A `"` or `'` string in a .menu file is never closed. */
  MenuUnterminatedString: 'menu-unterminated-string',
  /** The character before the closing `` ` `` of a .menu Lua block is not white space; the engine drops it. */
  MenuInlineLuaLastCharacter: 'menu-inline-lua-last-character',
  /** An unquoted word of 64 or more characters in a .menu file; the engine aborts. */
  MenuWordTooLong: 'menu-word-too-long',
  /** `_` joined to unquoted text in a .menu file; the engine skips it and splits the text. */
  MenuUnquotedUnderscore: 'menu-unquoted-underscore',
} as const;
export type DiagnosticCode = (typeof DiagnosticCode)[keyof typeof DiagnosticCode];

/** A problem as half-open document offsets `[start, end)`. */
export interface Problem {
  readonly start: number;
  readonly end: number;
  readonly message: string;
  readonly code: DiagnosticCode;
  readonly severity: 'error' | 'warning';
}
