// Layout-preserving formatting of a Lua 5.2 chunk (LSP `textDocument/formatting`,
// `/rangeFormatting` and `/onTypeFormatting`). Pure: no LSP or `vscode` imports;
// src/server/features/formatting.ts converts the result.
//
// Only the white space between tokens and comments is rewritten. Line breaks are
// kept exactly as written (same characters, same count), and the inside of every
// token and comment (strings, long strings, long comments) is never touched, apart
// from trailing white space at the end of a `--` comment. Within that white space:
//
// - Indentation: each line is indented by the constructs open at its start
//   (`function`, `do`, `then`, `else`, `repeat`, `(`, `[`, `{`), counted once per
//   line that opens them; a line that starts with closers (`end`, `until`, `else`,
//   `elseif`, `)`, `]`, `}`) is indented like the line that opened the construct.
//   A line that continues a statement inside a block (`if a and` / `b then`) gets
//   one more level.
// - Spacing within a line: see `inlineSpace`.
// - Trailing white space is removed, and lines holding only white space become empty.
//
// Safety: the formatted text is lexed again and must have exactly the same tokens
// and comments (`--` comments compared without trailing white space) and the same
// line breaks up to its last token or comment (only the final newlines may change, as
// `insertFinalNewline` and `trimFinalNewlines` ask); otherwise no edit is returned.
// White space between two tokens
// never changes their meaning in Lua 5.2 once it neither joins them (checked here)
// nor adds or removes a line break (never done), so the result compiles to the
// same program.

import type * as Ast from '../syntax/ast.ts';
import { lex, type Comment, type LexResult, type Token } from '../syntax/lexer.ts';

/** The LSP `FormattingOptions` the formatter honors. */
export interface FormattingOptions {
  /** Width of one indentation level in spaces, when `insertSpaces` is set. */
  readonly tabSize: number;
  /** Indent with `tabSize` spaces per level instead of one tab. */
  readonly insertSpaces: boolean;
  /** Document formatting only: add a line break at the end when there is none. */
  readonly insertFinalNewline?: boolean | undefined;
  /** Document formatting only: remove the line breaks after the last one that ends a line with content. */
  readonly trimFinalNewlines?: boolean | undefined;
}

/** Replace `[start, end)` of the original text with `newText`. */
export interface OffsetEdit {
  readonly start: number;
  readonly end: number;
  readonly newText: string;
}

export type FormatResult =
  | { readonly ok: true; readonly edits: readonly OffsetEdit[] }
  /**
   * `syntax-error`: the chunk has a lexical or syntax error where the formatted lines
   * depend on it. `unsafe`: the result would not have lexed to the same tokens (a
   * bug in the rules; nothing is changed). `invalid-options`: `insertSpaces` with a
   * `tabSize` that is not an integer from `MIN_TAB_SIZE` to `MAX_TAB_SIZE`.
   */
  | { readonly ok: false; readonly reason: 'syntax-error' | 'unsafe' | 'invalid-options' };

/**
 * The `tabSize` values accepted with `insertSpaces`: the bounds of VS Code's
 * `editor.tabSize` setting (`minimum: 1, maximum: 100` in its settings schema). LSP
 * only says `uinteger`; anything outside is refused rather than replaced by a guess.
 */
export const MIN_TAB_SIZE = 1;
export const MAX_TAB_SIZE = 100;

/** Whether the options are ones the formatter accepts (see `MIN_TAB_SIZE`). */
export const validOptions = (options: FormattingOptions): boolean =>
  !options.insertSpaces || (Number.isInteger(options.tabSize) && options.tabSize >= MIN_TAB_SIZE && options.tabSize <= MAX_TAB_SIZE);

/** Characters after which clients ask for on-type formatting. */
export const ON_TYPE_FIRST_TRIGGER = '\n';
export const ON_TYPE_MORE_TRIGGERS: readonly string[] = ['d', 'e', 'f', 'l', ')', ']', '}'];

/** Closers that can be completed by typing one of `ON_TYPE_MORE_TRIGGERS` (their last character). */
const CLOSERS: ReadonlySet<string> = new Set(['end', 'until', 'else', 'elseif', ')', ']', '}']);
const BLOCK_OPENERS: ReadonlySet<string> = new Set(['function', 'do', 'then', 'else', 'repeat']);
const BRACKET_OPENERS: ReadonlySet<string> = new Set(['(', '[', '{']);
/** Line-starting tokens that end a statement head and are indented like the statement (`while x` / `do`). */
const HEAD_ENDS: ReadonlySet<string> = new Set(['then', 'do']);
/** Horizontal white space as llex.c `lisspace` counts it, without the line breaks. */
const TRAILING_SPACE = /[ \t\v\f]+$/;

interface Item {
  readonly start: number;
  readonly end: number;
  /** Exactly one of `token` and `comment` is set. */
  readonly token: Token | undefined;
  readonly comment: Comment | undefined;
}

/**
 * What a token is, from its neighbors. Each rule is exact for valid Lua 5.2
 * (manual §9), and works from tokens alone, so that it holds before a syntax error
 * that makes the parser abandon the statement around it.
 */
interface TokenFacts {
  /** Offsets of the first token of every statement (`Ast.Chunk.statementStarts`). */
  readonly statementStarts: ReadonlySet<number>;
  /**
   * Offsets of unary `-` and `#` (`not` is a keyword and spaced like one). `#` is
   * always unary; `-` is unary unless it follows the end of an operand.
   */
  readonly unaryOperators: ReadonlySet<number>;
  /**
   * Offsets of string and table call arguments (`f"x"`, `f{…}`): a string or `{` that
   * follows the end of a prefix expression (a name, `)`, `]`, or another such argument).
   */
  readonly bareArguments: ReadonlySet<number>;
  /** Offsets of the name and the closing `::` of `::name::` labels, which join what precedes them. */
  readonly labelParts: ReadonlySet<number>;
}

/** Tokens after which an expression can end: then `-` is binary. */
function endsOperand(token: Token | undefined): boolean {
  if (token === undefined) return false;
  switch (token.type) {
    case 'name':
    case 'number':
    case 'string':
      return true;
    case 'keyword':
      // `end` closes a function expression; after any other `end`, `-` cannot follow.
      return token.value === 'nil' || token.value === 'true' || token.value === 'false' || token.value === 'end';
    case 'symbol':
      return token.value === ')' || token.value === ']' || token.value === '}' || token.value === '...';
    case 'eof':
      return false;
  }
}

function tokenFacts(tokens: readonly Token[], tree: Ast.Chunk): TokenFacts {
  const unaryOperators = new Set<number>();
  const bareArguments = new Set<number>();
  const labelParts = new Set<number>();
  /** Offsets of the `}` that close a table call argument. */
  const bareArgumentEnds = new Set<number>();
  /** For each open `{`: whether it is a call argument. */
  const braces: boolean[] = [];
  const symbol = (token: Token | undefined, value: string): boolean => token?.type === 'symbol' && token.value === value;
  tokens.forEach((token, i) => {
    const previous = tokens[i - 1];
    if (symbol(token, '#') || (symbol(token, '-') && !endsOperand(previous))) unaryOperators.add(token.start);
    const afterPrefix =
      previous !== undefined &&
      (previous.type === 'name' ||
        symbol(previous, ')') ||
        symbol(previous, ']') ||
        (previous.type === 'string' && bareArguments.has(previous.start)) ||
        bareArgumentEnds.has(previous.start));
    if (afterPrefix && (token.type === 'string' || symbol(token, '{'))) bareArguments.add(token.start);
    if (symbol(token, '{')) braces.push(bareArguments.has(token.start));
    if (symbol(token, '}') && braces.pop() === true) bareArgumentEnds.add(token.start);
    if (symbol(token, '::') && tokens[i + 1]?.type === 'name' && symbol(tokens[i + 2], '::')) {
      labelParts.add((tokens[i + 1] as Token).start);
      labelParts.add((tokens[i + 2] as Token).start);
    }
  });
  return { statementStarts: new Set(tree.statementStarts), unaryOperators, bareArguments, labelParts };
}

/** Line start offsets as LSP counts lines (`\r\n`, `\r` and `\n` each end one). */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\r') {
      if (text[i + 1] === '\n') i++;
      starts.push(i + 1);
    } else if (c === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

/** Zero-based line of `offset`. */
export function lineAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((starts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Splits white space `[start, end)` at its line breaks into the horizontal runs between them. */
function horizontalRuns(text: string, start: number, end: number): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let runStart = start;
  for (let i = start; i < end; i++) {
    const c = text[i];
    if (c !== '\r' && c !== '\n') continue;
    runs.push({ start: runStart, end: i });
    if (c === '\r' && text[i + 1] === '\n' && i + 1 < end) i++;
    runStart = i + 1;
  }
  runs.push({ start: runStart, end });
  return runs;
}

const isToken = (item: Item | undefined, value: string): boolean => item?.token?.value === value && item.token.type !== 'string';
const isLongString = (item: Item): boolean => item.token?.type === 'string' && item.token.value.startsWith('[');

/**
 * The space between two items on one line. `original` is the white space written
 * between them. Rules, first match wins:
 *
 * 1. before a comment: as written, at least one space; after a comment: one space
 * 2. inside `::name::`: none
 * 3. before `,` and `;`: none; after them: one space
 * 4. after `(` and `[`, before `)` and `]`: none (one between `[`/`]` and a long string, which would otherwise read as `[[`)
 * 5. after `{` and before `}`: one space; none in `{}`
 * 6. around `.` and `:`: none
 * 7. after unary `-` and `#`: none (one before another `-`, which would start a comment)
 * 8. before the `(` of a call, of a function's parameters, or the `[` of an index: none
 * 9. before a string or table call argument (`f"x"`, `f{…}`): none if none was written, otherwise one space
 * 10. anything else (keywords, binary operators, `=`, names): one space
 */
function inlineSpace(previous: Item, next: Item, original: string, facts: TokenFacts): string {
  if (next.comment) return original === '' ? ' ' : original;
  if (previous.comment) return ' ';
  if (facts.labelParts.has(next.start)) return '';
  if (isToken(next, ',') || isToken(next, ';')) return '';
  if (isToken(previous, ',') || isToken(previous, ';')) return ' ';
  if (isToken(previous, '(')) return '';
  if (isToken(next, ')')) return '';
  if (isToken(previous, '[')) return isLongString(next) ? ' ' : '';
  if (isToken(next, ']')) return isLongString(previous) ? ' ' : '';
  if (isToken(previous, '{')) return isToken(next, '}') ? '' : ' ';
  if (isToken(next, '}')) return ' ';
  if (isToken(previous, '.') || isToken(next, '.') || isToken(previous, ':') || isToken(next, ':')) return '';
  if (facts.unaryOperators.has(previous.start)) return isToken(next, '-') ? ' ' : '';
  const prefix =
    previous.token?.type === 'name' ||
    previous.token?.type === 'string' ||
    isToken(previous, ')') ||
    isToken(previous, ']') ||
    isToken(previous, '}');
  if (isToken(next, '(') && (prefix || isToken(previous, 'function'))) return '';
  if (isToken(next, '[') && prefix) return '';
  if (facts.bareArguments.has(next.start)) return original === '' ? '' : ' ';
  return ' ';
}

interface Frame {
  /** `true` for `function`, `do`, `then`, `else`, `repeat`; `false` for brackets. */
  readonly block: boolean;
  /** Indentation level of the lines inside the construct. */
  readonly inner: number;
}

interface Edits {
  readonly edits: OffsetEdit[];
  /** The lexed original text, reused by the safety check. */
  readonly lexed: LexResult;
}

/**
 * A chunk embedded in a larger text (a .menu file) rather than a whole file:
 * `baseLevel` is the indentation level of its outermost lines. The white space
 * before its first item on the line where the chunk starts, and after its last
 * item on the line where it ends, belongs to the embedding text and is not
 * changed; the other lines are formatted as in a file, `baseLevel` deeper.
 */
interface Embedding {
  readonly baseLevel: number;
}

/**
 * The edits of the chunk up to `limit` (edits may extend past it), without the
 * safety check. Edits are line-local, disjoint and in order. `finalNewlines`:
 * apply `insertFinalNewline` and `trimFinalNewlines` (whole files only).
 */
function allEdits(
  text: string,
  tree: Ast.Chunk,
  options: FormattingOptions,
  finalNewlines: boolean,
  limit = tree.end,
  embedding?: Embedding,
): Edits {
  const lexed = lex(text, tree.start, tree.end);
  const { tokens, comments } = lexed;
  const items: Item[] = [
    ...tokens.filter((token) => token.type !== 'eof').map((token) => ({ start: token.start, end: token.end, token, comment: undefined })),
    ...comments.map((comment) => ({ start: comment.start, end: comment.end, token: undefined, comment })),
  ].sort((a, b) => a.start - b.start);
  const facts = tokenFacts(tokens, tree);
  // `validOptions` was checked by the caller.
  const unit = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
  const edits: OffsetEdit[] = [];
  const replace = (start: number, end: number, newText: string): void => {
    if (text.slice(start, end) !== newText) edits.push({ start, end, newText });
  };

  const baseLevel = embedding?.baseLevel ?? 0;
  const stack: Frame[] = [];
  const innerLevel = (): number => stack.at(-1)?.inner ?? baseLevel;
  /** Closes the innermost construct when `token` is a closer; returns the level of the line that opened it. */
  const close = (token: Token | undefined): number | undefined => {
    if (token === undefined || token.type === 'string' || !CLOSERS.has(token.value)) return undefined;
    const frame = stack.pop();
    // No frame: a closer too many, only possible after a syntax error.
    return frame === undefined ? baseLevel : frame.inner - 1;
  };
  /** Indentation level of the current line, and that level without the continuation level. */
  let level = baseLevel;
  let statementLevel = baseLevel;
  /**
   * Opens a construct when `token` is an opener. `then` and `do` end the head of their
   * statement, so their block is indented from the statement even on a continuation line.
   */
  const open = (token: Token | undefined): void => {
    if (token === undefined || token.type === 'string') return;
    if (BLOCK_OPENERS.has(token.value)) stack.push({ block: true, inner: (HEAD_ENDS.has(token.value) ? statementLevel : level) + 1 });
    else if (BRACKET_OPENERS.has(token.value)) stack.push({ block: false, inner: level + 1 });
  };
  /** Whether a line break separates two items. */
  const broken = (a: Item, b: Item): boolean => horizontalRuns(text, a.end, b.start).length > 1;
  const space = (a: Item, b: Item): void => {
    replace(a.end, b.start, inlineSpace(a, b, text.slice(a.end, b.start), facts));
  };

  for (let i = 0; i < items.length; i++) {
    // `items[i]` exists: the loop bound.
    const item = items[i] as Item;
    const previous = items[i - 1];
    // Nothing from here on lies before `limit`: the white space before this item starts at or after it.
    if (previous !== undefined && previous.end >= limit) return { edits, lexed };
    if (previous !== undefined && !broken(previous, item)) {
      space(previous, item);
      close(item.token);
      open(item.token);
    } else {
      // First item of a line: trailing white space and blank lines before it become empty.
      const runs = horizontalRuns(text, previous?.end ?? tree.start, item.start);
      // An embedded chunk's first item on the line where the chunk starts: that line belongs to the embedding text.
      const embeddedFirstLine = embedding !== undefined && previous === undefined && runs.length === 1;
      for (const run of runs.slice(0, -1)) replace(run.start, run.end, '');
      // Closers that lead the line give it the level of the line that opened the last of them.
      let j = i;
      let leading: number | undefined;
      for (let candidate = items[j]; candidate !== undefined; candidate = items[j]) {
        if (j > i && broken(items[j - 1] as Item, candidate)) break;
        const closed = close(candidate.token);
        if (closed === undefined) break;
        leading = closed;
        j++;
      }
      const token = item.token;
      const continuation =
        token !== undefined &&
        !facts.statementStarts.has(item.start) &&
        !(token.type === 'keyword' && HEAD_ENDS.has(token.value)) &&
        (stack.at(-1)?.block ?? true);
      statementLevel = leading ?? innerLevel();
      level = statementLevel + (leading === undefined && continuation ? 1 : 0);
      // `horizontalRuns` always returns at least one run.
      const indentation = runs.at(-1) as { start: number; end: number };
      if (!embeddedFirstLine) replace(indentation.start, indentation.end, unit.repeat(level));
      if (j === i) {
        open(token);
      } else {
        // `else` closes `then` and opens its own block at this level.
        for (let k = i; k < j; k++) {
          if (k > i) space(items[k - 1] as Item, items[k] as Item);
          open(items[k]?.token);
        }
        i = j - 1;
      }
    }
    if (item.comment && !item.comment.long) {
      const trailing = TRAILING_SPACE.exec(text.slice(item.start, item.end));
      if (trailing) replace(item.end - trailing[0].length, item.end, '');
    }
  }

  // After the last item.
  const lastEnd = items.at(-1)?.end ?? tree.start;
  const runs = horizontalRuns(text, lastEnd, tree.end);
  if (embedding !== undefined) {
    // The white space after the last line break starts the embedding text's line.
    for (const run of runs.slice(0, -1)) replace(run.start, run.end, '');
  } else if (!finalNewlines || items.length === 0) {
    for (const run of runs) replace(run.start, run.end, '');
  } else if (runs.length === 1) {
    // No line break after the last item.
    replace(lastEnd, tree.end, options.insertFinalNewline === true ? endOfLine(text) : '');
  } else if (options.trimFinalNewlines === true && runs.length > 2) {
    const first = runs[0] as { start: number; end: number };
    replace(first.start, first.end, '');
    replace((runs[1] as { start: number }).start, tree.end, '');
  } else {
    for (const run of runs) replace(run.start, run.end, '');
  }
  return { edits, lexed };
}

/** The first line break of the text, or `\n` when it has none. */
export function endOfLine(text: string): string {
  return /\r\n|\r|\n/.exec(text)?.[0] ?? '\n';
}

/** Applies disjoint edits given in document order. */
export function applyEdits(text: string, edits: readonly OffsetEdit[]): string {
  let result = '';
  let position = 0;
  for (const edit of edits) {
    result += text.slice(position, edit.start) + edit.newText;
    position = edit.end;
  }
  return result + text.slice(position);
}

/**
 * The safety check: the edited text lexes to the same tokens, comments and errors,
 * with as many line breaks before its last token or comment.
 *
 * Every edit lies within the chunk (`allEdits` changes only the white space between its
 * items, and inserts a final newline at its end), so only the chunk's text is compared:
 * for a .menu file with thousands of chunks, rebuilding the whole document for each one
 * would cost the document's length every time. An edit outside the chunk fails the check.
 */
function preservesTokens(text: string, edits: readonly OffsetEdit[], before: LexResult, tree: Ast.Chunk): boolean {
  if (edits.some((edit) => edit.start < tree.start || edit.end > tree.end)) return false;
  const original = text.slice(tree.start, tree.end);
  const formatted = applyEdits(
    original,
    edits.map((edit) => ({ start: edit.start - tree.start, end: edit.end - tree.start, newText: edit.newText })),
  );
  // The lexer reads only `[from, to)` and has no rule for the start of the input, so the
  // chunk's text alone lexes like the chunk in place, its offsets shifted by `tree.start`.
  const after = lex(formatted);
  const sameTokens =
    before.tokens.length === after.tokens.length &&
    before.tokens.every((token, i) => {
      const other = after.tokens[i];
      return other !== undefined && token.type === other.type && token.value === other.value;
    });
  const commentText = (source: string, comment: Comment): string => {
    const raw = source.slice(comment.start, comment.end);
    return comment.long ? raw : raw.replace(TRAILING_SPACE, '');
  };
  const sameComments =
    before.comments.length === after.comments.length &&
    before.comments.every((comment, i) => {
      const other = after.comments[i];
      return other !== undefined && other.long === comment.long && commentText(text, comment) === commentText(formatted, other);
    });
  // Line breaks after the last token or comment are the final newlines that the options may change.
  const contentEnd = (result: LexResult, origin: number): number =>
    Math.max(origin, result.tokens.at(-2)?.end ?? origin, result.comments.at(-1)?.end ?? origin) - origin;
  const sameLines =
    lineStarts(original.slice(0, contentEnd(before, tree.start))).length === lineStarts(formatted.slice(0, contentEnd(after, 0))).length;
  return sameTokens && sameComments && sameLines && after.errors.length === before.errors.length;
}

function checked(text: string, tree: Ast.Chunk, edits: readonly OffsetEdit[], lexed: LexResult): FormatResult {
  return preservesTokens(text, edits, lexed, tree) ? { ok: true, edits } : { ok: false, reason: 'unsafe' };
}

/** Whether an error of the chunk starts before `offset`, i.e. can affect text before it. */
const errorBefore = (tree: Ast.Chunk, offset: number): boolean => tree.errors.some((error) => error.start < offset);

/** Formats a whole chunk. Refused when it has any lexical or syntax error. */
export function formatDocument(text: string, tree: Ast.Chunk, options: FormattingOptions): FormatResult {
  if (!validOptions(options)) return { ok: false, reason: 'invalid-options' };
  if (tree.errors.length > 0) return { ok: false, reason: 'syntax-error' };
  const { edits, lexed } = allEdits(text, tree, options, true);
  return checked(text, tree, edits, lexed);
}

/**
 * Formats a chunk embedded in a larger text (the Lua of a .menu file), its lines
 * indented `baseLevel` levels deeper than in a file. The line where the chunk
 * starts keeps the white space before its first item, and the line where it ends
 * the white space after its last item: both belong to the embedding text. Final
 * newlines are not changed. Refused when the chunk has any lexical or syntax error.
 */
export function formatEmbedded(text: string, tree: Ast.Chunk, options: FormattingOptions, baseLevel: number): FormatResult {
  if (!validOptions(options)) return { ok: false, reason: 'invalid-options' };
  if (tree.errors.length > 0) return { ok: false, reason: 'syntax-error' };
  const { edits, lexed } = allEdits(text, tree, options, false, tree.end, { baseLevel });
  return checked(text, tree, edits, lexed);
}

/**
 * Formats the whole lines that `[start, end)` touches (a range that ends at the
 * start of a line does not include that line). Errors after those lines are
 * allowed: the layout of a line depends only on the text up to it.
 */
export function formatRange(text: string, tree: Ast.Chunk, options: FormattingOptions, start: number, end: number): FormatResult {
  const starts = lineStarts(text);
  const firstLine = lineAt(starts, start);
  let lastLine = lineAt(starts, end);
  if (lastLine > firstLine && starts[lastLine] === end) lastLine--;
  return formatSpan(text, tree, options, { from: starts[firstLine] ?? 0, to: starts[lastLine + 1] ?? text.length });
}

interface Span {
  /**
   * Only the edits within `[from, to)` are kept; an insertion at `to` belongs to the
   * next line (its indentation) and is not kept.
   */
  readonly from: number;
  readonly to: number;
  readonly keep?: (edit: OffsetEdit) => boolean;
}

function formatSpan(text: string, tree: Ast.Chunk, options: FormattingOptions, span: Span): FormatResult {
  if (!validOptions(options)) return { ok: false, reason: 'invalid-options' };
  if (errorBefore(tree, span.to)) return { ok: false, reason: 'syntax-error' };
  const { edits: all, lexed } = allEdits(text, tree, options, false, span.to);
  const edits = all.filter(
    (edit) => edit.start >= span.from && edit.start < span.to && edit.end <= span.to && (span.keep?.(edit) ?? true),
  );
  return checked(text, tree, edits, lexed);
}

/**
 * On-type formatting after `character` was typed and the cursor is at `offset`.
 * - A line break: formats the line it ended, and indents the new line when it has
 *   text after the cursor (a blank new line keeps the editor's indentation).
 * - The last character of `end`, `else`, `elseif`, `until`, `)`, `]` or `}`: indents
 *   the line when that closer is its first token. Anything else: no edits.
 */
export function formatOnType(text: string, tree: Ast.Chunk, options: FormattingOptions, offset: number, character: string): FormatResult {
  const starts = lineStarts(text);
  const line = lineAt(starts, offset);
  const lineStart = starts[line] ?? 0;
  const lineEnd = starts[line + 1] ?? text.length;
  if (character === ON_TYPE_FIRST_TRIGGER) {
    if (line === 0) return { ok: true, edits: [] };
    const blank = text.slice(lineStart, lineEnd).trim() === '';
    return formatSpan(text, tree, options, { from: starts[line - 1] ?? 0, to: lineEnd, keep: (edit) => !(blank && edit.start >= lineStart) });
  }
  const closer = typedCloser(text, tree, lineStart, offset, character);
  if (closer === undefined) return { ok: true, edits: [] };
  // Up to the end of the closer, which must not be an error itself (an `end` too many).
  // A keyword or symbol has no edits inside, so only the indentation is kept.
  return formatSpan(text, tree, options, { from: lineStart, to: closer });
}

/**
 * When typing `character` just completed a closer (`end`, `else`, `elseif`, `until`,
 * `)`, `]`, `}`) of `tree` that ends at `offset` and is the first token of the line
 * starting at `lineStart`: the end offset of that closer. Otherwise `undefined`.
 */
export function typedCloser(text: string, tree: Ast.Chunk, lineStart: number, offset: number, character: string): number | undefined {
  if (!ON_TYPE_MORE_TRIGGERS.includes(character)) return undefined;
  // Cheap test first: these characters are typed inside any word (`field`, `self`), and lexing
  // the document for each of them would cost a full pass. The lexer then confirms the closer
  // is a token, not part of a string, a comment or a longer name.
  const typed = text.slice(lineStart, offset).trim();
  if (!CLOSERS.has(typed) || !typed.endsWith(character)) return undefined;
  const { tokens } = lex(text, tree.start, tree.end);
  const index = tokens.findIndex((token) => token.end === offset && token.type !== 'string');
  const token = tokens[index];
  const before = tokens[index - 1];
  if (token === undefined || !CLOSERS.has(token.value) || !token.value.endsWith(character)) return undefined;
  // The closer must be the first token of its line, and no comment may come before it there.
  const firstOnLine = (before === undefined || before.end <= lineStart) && text.slice(lineStart, token.start).trim() === '';
  return firstOnLine ? token.end : undefined;
}
