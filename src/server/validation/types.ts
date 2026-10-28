// Plain data types for the validation pipeline. No LSP or `vscode` imports, so
// everything under src/server/validation/ can be unit-tested in plain Node.

/** A region of a document that holds Lua source. */
export interface LuaChunk {
  /**
   * `statements`: a full chunk (a `.lua` file, a `` `…` `` block, an `action "…"` script).
   * `expression`: a value the engine evaluates (`enabled "…"`, `<property> lua "…"`);
   * validated as `return <expression>`.
   */
  readonly kind: 'statements' | 'expression';
  /** Offset of the first character of the Lua text in the document. */
  readonly offset: number;
  /** The Lua text exactly as it appears in the document. */
  readonly text: string;
}

/** Stable diagnostic codes. Never rename one: users may filter or suppress them. */
export const DiagnosticCode = {
  /** Reported by the official Lua 5.2.4 compiler. */
  LuaSyntax: 'lua-syntax',
  /** A `` ` `` Lua block in a .menu file is never closed. */
  MenuUnterminatedBlock: 'menu-unterminated-block',
  /** A `"` string in a .menu file is never closed. */
  MenuUnterminatedString: 'menu-unterminated-string',
} as const;
export type DiagnosticCode = (typeof DiagnosticCode)[keyof typeof DiagnosticCode];

/** A problem as half-open document offsets `[start, end)`. */
export interface Problem {
  readonly start: number;
  readonly end: number;
  readonly message: string;
  readonly code: DiagnosticCode;
}
