// Lexer for Infinity Engine MENU files. Pure: no LSP or `vscode` imports.
//
// Follows IESDP, "MENU file format", section Lexical structure
// (https://gibberlings3.github.io/iesdp/file_formats/ie_formats/menu_v1.htm, commit 38e7532),
// which describes the lexer of BGEE, BG2EE and IWDEE 2.6.6.0 and 2.7.3.0:
//
// - white space is any character C `isspace` accepts (space, tab, CR, LF, VT, FF);
// - `--` starts a comment that runs to the end of the line; a single `-` is a minus sign;
// - `{` and `}` open and close a block;
// - a string runs from `"` or `'` to the next occurrence of the same quote, with no
//   escape sequences, across lines; an unterminated string runs to the end of the file;
// - a number is a run of decimal digits;
// - a word is a run of ASCII letters and digits that does not start with a digit. A
//   keyword (compared case-insensitively) is that keyword; any other word is a string;
// - text between two backticks is inline Lua, which produces no token;
// - any other character (`,` `;` `=` `(` `.` `_` …) is skipped.

import { menuKeyword } from './menuKeywords.ts';
import { DiagnosticCode, type Problem } from './types.ts';

export interface MenuToken {
  /**
   * `string` covers both quoted strings and words that are not keywords, which
   * the engine treats exactly like strings.
   */
  readonly type: 'keyword' | 'string' | 'number' | '{' | '}' | '-';
  /** Half-open offsets of the whole token, quotes included. */
  readonly start: number;
  readonly end: number;
  /** Half-open offsets of the value: a string without its quotes, or the word or number itself. */
  readonly valueStart: number;
  readonly valueEnd: number;
  /** The keyword in lower case (`keyword` tokens only). */
  readonly keyword?: string;
  /** The quote character of a quoted string; `undefined` for words and other tokens. */
  readonly quote?: '"' | "'";
}

/** A `` `…` `` block of inline Lua. */
export interface MenuInlineLua {
  /** Offset of the opening backtick. */
  readonly start: number;
  /** Offset of the closing backtick. */
  readonly close: number;
}

export interface MenuLexResult {
  /** Tokens in document order. Inline Lua blocks produce none. */
  readonly tokens: MenuToken[];
  readonly inline: MenuInlineLua[];
  readonly problems: Problem[];
}

/** C `isspace` in the "C" locale. */
export function isMenuSpace(c: string | undefined): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\v' || c === '\f';
}

function isLetter(c: string | undefined): boolean {
  return c !== undefined && /^[A-Za-z]$/.test(c);
}

function isDigit(c: string | undefined): boolean {
  return c !== undefined && /^[0-9]$/.test(c);
}

/** Splits a MENU file into tokens. Never throws. */
export function lexMenu(text: string): MenuLexResult {
  const tokens: MenuToken[] = [];
  const inline: MenuInlineLua[] = [];
  const problems: Problem[] = [];
  const simple = (type: '{' | '}' | '-', start: number): void => {
    tokens.push({ type, start, end: start + 1, valueStart: start, valueEnd: start + 1 });
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '-' && text[i + 1] === '-') {
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
    } else if (c === '-' || c === '{' || c === '}') {
      simple(c, i);
      i++;
    } else if (c === '`') {
      const close = text.indexOf('`', i + 1);
      if (close < 0) {
        problems.push({
          start: i,
          end: i + 1,
          message: 'Unterminated Lua block: missing closing "`".',
          code: DiagnosticCode.MenuUnterminatedBlock,
        });
        break;
      }
      inline.push({ start: i, close });
      i = close + 1;
    } else if (c === '"' || c === "'") {
      const close = text.indexOf(c, i + 1);
      if (close < 0) {
        problems.push({
          start: i,
          end: i + 1,
          message: c === '"' ? 'Unterminated string: missing closing \'"\'.' : 'Unterminated string: missing closing "\'".',
          code: DiagnosticCode.MenuUnterminatedString,
        });
        tokens.push({ type: 'string', start: i, end: text.length, valueStart: i + 1, valueEnd: text.length, quote: c });
        break;
      }
      tokens.push({ type: 'string', start: i, end: close + 1, valueStart: i + 1, valueEnd: close, quote: c });
      i = close + 1;
    } else if (isDigit(c)) {
      const start = i;
      while (isDigit(text[i])) i++;
      tokens.push({ type: 'number', start, end: i, valueStart: start, valueEnd: i });
    } else if (isLetter(c)) {
      const start = i;
      while (isLetter(text[i]) || isDigit(text[i])) i++;
      const keyword = menuKeyword(text.slice(start, i));
      tokens.push(
        keyword === undefined
          ? { type: 'string', start, end: i, valueStart: start, valueEnd: i }
          : { type: 'keyword', start, end: i, valueStart: start, valueEnd: i, keyword },
      );
    } else {
      i++;
    }
  }
  return { tokens, inline, problems };
}
