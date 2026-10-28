import { DiagnosticCode, type LuaChunk, type Problem } from './types.ts';

/**
 * Properties whose `"…"` value is a Lua script (one or more statements),
 * compared case-insensitively. Every entry was observed with Lua statements in
 * the game's own UI.MENU; properties not listed here are never validated.
 */
const STATEMENT_PROPERTIES: ReadonlySet<string> = new Set([
  'action',
  'actionalt',
  'actiondbl',
  'actiondrag',
  'actionenter',
  'actionexit',
  'actionhold',
  'actionscroll',
  'actionsimpledrag',
  'actionsimpledrop',
  'actionupdate',
  'onclose',
  'onopen',
]);

/**
 * Properties whose `"…"` value is a Lua expression without the `lua` keyword
 * (e.g. `enabled "bookMode == 1"`), compared case-insensitively.
 */
const EXPRESSION_PROPERTIES: ReadonlySet<string> = new Set(['enabled']);

/** A word of a .menu file, as half-open document offsets. */
export interface MenuWord {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** A `{ … }` block of a .menu file (`menu`, `button`, `label`, …). */
export interface MenuBlock {
  /**
   * The first word of the line holding `{`, or of the last non-empty line before
   * it when `{` is alone on its line: `menu`, `button`, … `undefined` if none.
   */
  readonly keyword: MenuWord | undefined;
  /** Offset of `{`. */
  readonly open: number;
  /** Offset of the matching `}`; `undefined` when the block is never closed. */
  readonly close: number | undefined;
  /** Text of the first `name '…'` / `name "…"` property directly inside the block (offsets exclude the quotes). */
  readonly name: MenuWord | undefined;
  readonly children: readonly MenuBlock[];
}

export interface MenuExtraction {
  readonly chunks: LuaChunk[];
  readonly problems: Problem[];
  /** Top-level `{ … }` blocks, with their nested blocks. */
  readonly blocks: MenuBlock[];
}

interface OpenBlock {
  keyword: MenuWord | undefined;
  open: number;
  close: number | undefined;
  name: MenuWord | undefined;
  children: OpenBlock[];
}

function isWordChar(c: string | undefined): boolean {
  return c !== undefined && /[A-Za-z0-9_.+-]/.test(c);
}

/**
 * Finds the Lua embedded in an Infinity Engine `.menu` file:
 *
 * - `` `…` `` blocks: Lua statements.
 * - `<property> lua "…"`: a Lua expression.
 * - `"…"` after a property in STATEMENT_PROPERTIES / EXPRESSION_PROPERTIES.
 *   The property may be on the same line as the string or on the previous
 *   non-empty line (`action` followed by `"` on the next line).
 *
 * `--` starts a comment that runs to the end of the line, `'…'` is a plain menu
 * string, and a `"` string ends at the next `"` (the format has no escapes).
 *
 * The same scan also records the nesting of `{ … }` blocks and their `name`.
 */
export function extractMenuLua(text: string): MenuExtraction {
  const chunks: LuaChunk[] = [];
  const problems: Problem[] = [];
  const blocks: OpenBlock[] = [];
  /** Blocks whose `}` has not been seen yet, innermost last. */
  const open: OpenBlock[] = [];
  // Words on the current line, and the words of the last line that had any.
  let lineWords: MenuWord[] = [];
  let previousLineWords: MenuWord[] = [];
  let i = 0;

  const endLine = (): void => {
    if (lineWords.length > 0) {
      previousLineWords = lineWords;
      lineWords = [];
    }
  };

  while (i < text.length) {
    const c = text[i];
    if (c === '\n' || c === '\r') {
      endLine();
      i++;
    } else if (c === '-' && text[i + 1] === '-') {
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
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
      chunks.push({ kind: 'statements', origin: 'block', offset: i + 1, text: text.slice(i + 1, close) });
      lineWords = [];
      previousLineWords = [];
      i = close + 1;
    } else if (c === '"' || c === "'") {
      const close = text.indexOf(c, i + 1);
      if (close < 0) {
        if (c === '"') {
          problems.push({
            start: i,
            end: i + 1,
            message: 'Unterminated string: missing closing \'"\'.',
            code: DiagnosticCode.MenuUnterminatedString,
          });
        }
        break;
      }
      const words = lineWords.length > 0 ? lineWords : previousLineWords;
      if (c === '"') {
        const kind = classify(lineWords, previousLineWords);
        if (kind) {
          chunks.push({ kind, origin: 'property', offset: i + 1, text: text.slice(i + 1, close) });
        }
      }
      const block = open.at(-1);
      if (block && block.name === undefined && words.length === 1 && words[0]?.text.toLowerCase() === 'name') {
        block.name = { text: text.slice(i + 1, close), start: i + 1, end: close };
      }
      // A string completes a property; the next string needs its own keyword.
      lineWords = [];
      previousLineWords = [];
      i = close + 1;
    } else if (c === '{') {
      const words = lineWords.length > 0 ? lineWords : previousLineWords;
      const block: OpenBlock = { keyword: words[0], open: i, close: undefined, name: undefined, children: [] };
      (open.at(-1)?.children ?? blocks).push(block);
      open.push(block);
      lineWords = [];
      previousLineWords = [];
      i++;
    } else if (c === '}') {
      const block = open.pop();
      if (block) block.close = i;
      lineWords = [];
      previousLineWords = [];
      i++;
    } else if (isWordChar(c)) {
      const start = i;
      while (isWordChar(text[i])) i++;
      lineWords.push({ text: text.slice(start, i), start, end: i });
    } else {
      i++;
    }
  }
  return { chunks, problems, blocks };
}

function classify(lineWords: readonly MenuWord[], previousLineWords: readonly MenuWord[]): LuaChunk['kind'] | undefined {
  if (lineWords.at(-1)?.text.toLowerCase() === 'lua') {
    return 'expression';
  }
  const words = lineWords.length > 0 ? lineWords : previousLineWords;
  const property = words[0]?.text.toLowerCase();
  if (property === undefined || words.length !== 1) {
    return undefined;
  }
  if (STATEMENT_PROPERTIES.has(property)) {
    return 'statements';
  }
  if (EXPRESSION_PROPERTIES.has(property)) {
    return 'expression';
  }
  return undefined;
}
