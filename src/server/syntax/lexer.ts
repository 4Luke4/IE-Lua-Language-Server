// Lua 5.2 lexer, following the official lexer (lua-5.2.4/src/llex.c). Pure: no
// LSP or `vscode` imports. Offsets are positions in the JavaScript string (UTF-16
// code units), the same unit `TextDocument.positionAt` uses, so tokens of a
// chunk embedded in a .menu file carry document offsets directly.

export type TokenType = 'name' | 'keyword' | 'number' | 'string' | 'symbol' | 'eof';

export interface Token {
  readonly type: TokenType;
  /** Keyword or symbol text; the identifier for names; the source text for numbers and strings. */
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

export interface Comment {
  readonly start: number;
  readonly end: number;
  /** `--[[ … ]]` (any level) rather than `-- …` to the end of the line. */
  readonly long: boolean;
}

/** A lexical or syntax error as half-open offsets `[start, end)`. */
export interface ParseError {
  readonly start: number;
  readonly end: number;
  readonly message: string;
}

export interface LexResult {
  /** Always ends with one `eof` token. */
  readonly tokens: Token[];
  readonly comments: Comment[];
  readonly errors: ParseError[];
}

/** The 22 reserved words of Lua 5.2 (manual §3.1). */
export const KEYWORDS: ReadonlySet<string> = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in',
  'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
]);

const isNewline = (c: string | undefined): boolean => c === '\n' || c === '\r';
// llex.c uses lctype.c with LUA_UCID undefined: identifiers are ASCII only.
const isAlpha = (c: string | undefined): boolean => c !== undefined && /[A-Za-z_]/.test(c);
const isAlnum = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c);
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isHexDigit = (c: string | undefined): boolean => c !== undefined && /[0-9A-Fa-f]/.test(c);
// lisspace: ' ', \t, \n, \v, \f, \r.
const isSpace = (c: string | undefined): boolean => c !== undefined && /[ \t\n\v\f\r]/.test(c);

// luaO_str2d: decimal numbers go through strtod (but `inf`/`nan` are refused,
// and the lexer never reads letters other than hex digits and the exponent);
// hexadecimal ones through lua_strx2number, which needs at least one digit and
// a decimal exponent after `p`.
const DECIMAL = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const HEXADECIMAL = /^0[xX](?:[0-9A-Fa-f]+\.?[0-9A-Fa-f]*|\.[0-9A-Fa-f]+)(?:[pP][+-]?\d+)?$/;

/** Symbols of more than one character, longest first. */
const LONG_SYMBOLS = ['...', '..', '==', '~=', '<=', '>=', '::'];

/**
 * Splits `source[from, to)` into tokens. Never throws: every problem is
 * recorded in `errors` and lexing goes on, so that a tree can still be built.
 */
export function lex(source: string, from = 0, to = source.length): LexResult {
  const tokens: Token[] = [];
  const comments: Comment[] = [];
  const errors: ParseError[] = [];
  let i = from;

  const at = (index: number): string | undefined => (index < to ? source[index] : undefined);
  const error = (start: number, end: number, message: string): void => {
    errors.push({ start, end, message });
  };

  /**
   * llex.c `skip_sep`: at `[` or `]`, counts the `=` that follow. Returns the
   * level when the same bracket follows them, otherwise `-1 - count`.
   */
  const separator = (index: number): number => {
    const bracket = at(index);
    let j = index + 1;
    while (at(j) === '=') j++;
    return at(j) === bracket ? j - index - 1 : -1 - (j - index - 1);
  };

  /** Reads `[==[ … ]==]` starting at `i`; returns the end offset (or `to` when unfinished). */
  const longBracket = (level: number, what: 'string' | 'comment'): number => {
    const start = i;
    let j = i + level + 2;
    while (j < to) {
      if (source[j] === ']' && separator(j) === level) {
        return j + level + 2;
      }
      j++;
    }
    error(start, to, `unfinished long ${what}`);
    return to;
  };

  /** Reads a `'…'` or `"…"` string starting at `i`; returns its end offset. */
  const shortString = (): number => {
    const start = i;
    const quote = source[i];
    let j = i + 1;
    for (;;) {
      const c = at(j);
      if (c === undefined || isNewline(c)) {
        error(start, j, 'unfinished string');
        return j;
      }
      if (c === quote) {
        return j + 1;
      }
      if (c !== '\\') {
        j++;
        continue;
      }
      // llex.c `read_string`, escape sequences.
      const escapeStart = j;
      const e = at(j + 1);
      j += 2;
      if (e === undefined) {
        continue; // reported as an unfinished string on the next iteration
      }
      if ('abfnrtv\\"\''.includes(e)) {
        continue;
      }
      if (isNewline(e)) {
        // `\` followed by a line break: \n, \r, \r\n and \n\r count as one.
        const next = at(j);
        if (isNewline(next) && next !== e) j++;
        continue;
      }
      if (e === 'x') {
        if (isHexDigit(at(j)) && isHexDigit(at(j + 1))) {
          j += 2;
        } else {
          error(escapeStart, Math.min(j + 2, to), 'hexadecimal digit expected');
        }
        continue;
      }
      if (e === 'z') {
        while (isSpace(at(j))) j++;
        continue;
      }
      if (isDigit(e)) {
        let k = j;
        while (k < j + 2 && isDigit(at(k))) k++;
        if (Number(source.slice(j - 1, k)) > 255) {
          error(escapeStart, k, 'decimal escape too large');
        }
        j = k;
        continue;
      }
      error(escapeStart, j, 'invalid escape sequence');
    }
  };

  /** llex.c `read_numeral`: reads digits, hex digits, `.` and signed exponents. */
  const numeral = (): number => {
    const start = i;
    let exponent = 'Ee';
    let j = i + 1;
    if (source[i] === '0' && (at(j) === 'x' || at(j) === 'X')) {
      exponent = 'Pp';
      j++;
    }
    for (;;) {
      const c = at(j);
      if (c !== undefined && exponent.includes(c)) {
        j++;
        if (at(j) === '+' || at(j) === '-') j++;
      } else if (isHexDigit(c) || c === '.') {
        j++;
      } else {
        break;
      }
    }
    const text = source.slice(start, j);
    if (!(exponent === 'Pp' ? HEXADECIMAL : DECIMAL).test(text)) {
      error(start, j, 'malformed number');
    }
    return j;
  };

  const push = (type: TokenType, start: number, end: number, value = source.slice(start, end)): void => {
    tokens.push({ type, value, start, end });
  };

  while (i < to) {
    const c = source[i];
    if (isSpace(c)) {
      i++;
    } else if (c === '-' && at(i + 1) === '-') {
      const start = i;
      i += 2;
      if (at(i) === '[') {
        const level = separator(i);
        if (level >= 0) {
          i = longBracket(level, 'comment');
          comments.push({ start, end: i, long: true });
          continue;
        }
      }
      while (i < to && !isNewline(source[i])) i++;
      comments.push({ start, end: i, long: false });
    } else if (c === '[') {
      const level = separator(i);
      if (level >= 0) {
        const start = i;
        i = longBracket(level, 'string');
        push('string', start, i);
      } else {
        if (level !== -1) {
          error(i, i + 1 - level - 1, 'invalid long string delimiter');
        }
        push('symbol', i, i + 1);
        i++;
      }
    } else if (c === '"' || c === "'") {
      const start = i;
      i = shortString();
      push('string', start, i);
    } else if (c === '.' && isDigit(at(i + 1))) {
      const start = i;
      i = numeral();
      push('number', start, i);
    } else if (isDigit(c)) {
      const start = i;
      i = numeral();
      push('number', start, i);
    } else if (isAlpha(c)) {
      const start = i;
      while (isAlnum(at(i))) i++;
      const word = source.slice(start, i);
      push(KEYWORDS.has(word) ? 'keyword' : 'name', start, i, word);
    } else {
      const symbol = LONG_SYMBOLS.find((s) => source.startsWith(s, i) && i + s.length <= to);
      const length = symbol?.length ?? 1;
      // Any other character becomes a one-character token (llex.c `default:`);
      // the parser then reports it as an unexpected symbol.
      push('symbol', i, i + length);
      i += length;
    }
  }
  tokens.push({ type: 'eof', value: '<eof>', start: to, end: to });
  return { tokens, comments, errors };
}
