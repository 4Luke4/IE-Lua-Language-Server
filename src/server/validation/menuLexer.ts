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
  if (c === undefined) return false;
  const code = c.charCodeAt(0) | 0x20; // ASCII upper case to lower case
  return code >= 0x61 && code <= 0x7a;
}

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9';
}

const LINE_END = /[\n\r]/g;

/** IESDP, Limits: "A longer unquoted word [than 63 characters] aborts the game." */
export const MAX_WORD_LENGTH = 64;

function isWordOrUnderscore(c: string | undefined): boolean {
  return c === '_' || isLetter(c) || isDigit(c);
}

/**
 * The run of letters, digits and `_` around the `_` at `at`, and the words and
 * numbers the engine reads from it (none when the run is only underscores).
 */
function underscoreRun(text: string, at: number): { start: number; end: number; parts: string[] } {
  let start = at;
  while (start > 0 && isWordOrUnderscore(text[start - 1])) start--;
  let end = at;
  while (isWordOrUnderscore(text[end])) end++;
  return { start, end, parts: text.slice(start, end).match(/[A-Za-z][A-Za-z0-9]*|[0-9]+/g) ?? [] };
}

/** Splits a MENU file into tokens. Never throws. */
export function lexMenu(text: string): MenuLexResult {
  const tokens: MenuToken[] = [];
  const inline: MenuInlineLua[] = [];
  const problems: Problem[] = [];
  const simple = (type: '{' | '}' | '-', start: number): void => {
    tokens.push({ type, start, end: start + 1, valueStart: start, valueEnd: start + 1 });
  };
  /** End of the last run reported by the underscore check, so each run is reported once. */
  let underscoreRunEnd = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '-' && text[i + 1] === '-') {
      LINE_END.lastIndex = i + 2;
      i = LINE_END.exec(text)?.index ?? text.length;
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
          severity: 'error',
        });
        break;
      }
      inline.push({ start: i, close });
      const last = close - 1;
      if (last > i && !isMenuSpace(text[last])) {
        problems.push({
          start: last,
          end: close,
          message: `The engine drops the last character before the closing "\`", so ${JSON.stringify(text[last])} is not run. End the block with a line break or a space.`,
          code: DiagnosticCode.MenuInlineLuaLastCharacter,
          severity: 'warning',
        });
      }
      i = close + 1;
    } else if (c === '"' || c === "'") {
      const close = text.indexOf(c, i + 1);
      if (close < 0) {
        problems.push({
          start: i,
          end: i + 1,
          message: c === '"' ? 'Unterminated string: missing closing \'"\'.' : 'Unterminated string: missing closing "\'".',
          code: DiagnosticCode.MenuUnterminatedString,
          severity: 'error',
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
      if (i - start >= MAX_WORD_LENGTH) {
        problems.push({
          start,
          end: i,
          message: `This unquoted word has ${i - start} characters; the engine aborts on words of ${MAX_WORD_LENGTH} or more. Quote it.`,
          code: DiagnosticCode.MenuWordTooLong,
          severity: 'error',
        });
      }
      const keyword = menuKeyword(text.slice(start, i));
      tokens.push(
        keyword === undefined
          ? { type: 'string', start, end: i, valueStart: start, valueEnd: i }
          : { type: 'keyword', start, end: i, valueStart: start, valueEnd: i, keyword },
      );
    } else {
      if (c === '_' && i >= underscoreRunEnd) {
        const run = underscoreRun(text, i);
        underscoreRunEnd = run.end;
        if (run.parts.length > 0) {
          const written = text.slice(run.start, run.end);
          problems.push({
            start: run.start,
            end: run.end,
            message: `The engine skips "_" in unquoted text, so ${written} is read as ${run.parts.join(' ')}. Quote it: "${written}".`,
            code: DiagnosticCode.MenuUnquotedUnderscore,
            severity: 'warning',
          });
        }
      }
      i++;
    }
  }
  return { tokens, inline, problems };
}
