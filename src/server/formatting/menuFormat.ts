// Layout-preserving formatting of an Infinity Engine .menu file (LSP
// `textDocument/formatting`, `/rangeFormatting` and `/onTypeFormatting`). Pure: no LSP
// or `vscode` imports; src/server/features/formatting.ts converts the result.
//
// Only white space is rewritten, and only where the engine's lexer (IESDP, MENU file
// format, Lexical structure; see src/server/validation/menuLexer.ts) skips it:
//
// - The menu structure: each line is indented by the `{ … }` blocks open at its start;
//   a line that starts with `}` is indented like the line that opened that block.
//   Trailing white space is removed, and lines holding only white space become empty.
// - The embedded Lua (`` `…` `` blocks and Lua strings, see menuExtractor.ts): each chunk
//   is formatted by `formatEmbedded` (format.ts). The lines of a chunk that spans lines
//   are indented one level deeper than the line where it starts (`action "` or a `"` on
//   its own line), except in `` ` `` blocks outside any `{ … }` block, which hold a file's
//   top-level Lua at level 0, as in a Lua file. A line that starts with the chunk's
//   closing backtick or quote is indented like the line where the chunk starts. A chunk with a
//   Lua syntax error is left exactly as written, and so is every line that starts inside
//   a string that is not Lua (its line breaks and indentation are part of the string).
//
// Line breaks are never added or removed (apart from the final newlines that the options
// ask for), and nothing is ever inserted between two characters that are not separated by
// white space, so no token is joined, split or changed. White space before a closing
// backtick stays white space: the engine drops the last character before it (IESDP), and
// that character is white space before and after formatting, or not touched at all.
//
// Safety: the result is lexed and extracted again and must give the same menu tokens, the
// same Lua chunks with the same Lua tokens and comments, the same problems and the same
// number of lines; otherwise no edit is returned.

import type { Runtime } from '../../shared/settings.ts';
import type { ParsedDocument } from '../syntax/document.ts';
import { lex, type LexResult } from '../syntax/lexer.ts';
import { extractMenuLua, type MenuExtraction } from '../validation/menuExtractor.ts';
import { lexMenu, type MenuLexResult } from '../validation/menuLexer.ts';
import { DiagnosticCode } from '../validation/types.ts';
import {
  applyEdits,
  endOfLine,
  formatEmbedded,
  lineAt,
  lineStarts,
  ON_TYPE_FIRST_TRIGGER,
  typedCloser,
  validOptions,
  type FormattingOptions,
  type OffsetEdit,
} from './format.ts';

export type MenuFormatResult =
  /** `unformatted`: how many Lua chunks were left as written because they have a syntax error. */
  | { readonly ok: true; readonly edits: readonly OffsetEdit[]; readonly unformatted: number }
  /**
   * `syntax-error`: the file has an unterminated string or `` `…` `` block, so where its
   * lines start cannot be known (an unterminated string runs to the end of the file).
   * `unsafe` and `invalid-options`: as for Lua files (format.ts).
   */
  | { readonly ok: false; readonly reason: 'syntax-error' | 'unsafe' | 'invalid-options' };

/** Horizontal white space as the engine's lexer counts it (C `isspace` without the line breaks). */
const HORIZONTAL = /[ \t\v\f]/;
const isHorizontal = (c: string | undefined): boolean => c !== undefined && HORIZONTAL.test(c);

/** Half-open span of the text. */
interface Span {
  readonly start: number;
  readonly end: number;
}

/** A Lua chunk with what formatting needs to know about it. */
interface ChunkLayout {
  /** The chunk's region in the document, delimiters included. */
  readonly region: Span;
  /** Offset of the closing delimiter (backtick or quote); `undefined` for an unquoted word. */
  readonly closer: number | undefined;
  /** Whether `formatEmbedded` formatted it (`false`: left as written). */
  readonly formatted: boolean;
}

interface Layout {
  readonly edits: OffsetEdit[];
  readonly unformatted: number;
  readonly chunks: readonly ChunkLayout[];
}

/** Index of the last item whose start (`startOf`) is before `offset`, in items sorted by start; -1 when none is. */
function lastStartingBefore<T>(sorted: readonly T[], startOf: (item: T) => number, offset: number): number {
  let low = 0;
  let high = sorted.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const item = sorted[middle];
    if (item !== undefined && startOf(item) < offset) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** Whether the file has an error that hides where its lines start. */
function unterminated(lexed: MenuLexResult): boolean {
  return lexed.problems.some(
    (problem) => problem.code === DiagnosticCode.MenuUnterminatedString || problem.code === DiagnosticCode.MenuUnterminatedBlock,
  );
}

/**
 * All edits of the document. `finalNewlines`: apply `insertFinalNewline` and
 * `trimFinalNewlines` (document formatting only). `undefined` when `formatEmbedded`
 * reports a result that would not lex to the same tokens.
 */
function layout(parsed: ParsedDocument, lexed: MenuLexResult, options: FormattingOptions, finalNewlines: boolean): Layout | undefined {
  const { text } = parsed;
  const starts = lineStarts(text);
  // `validOptions` was checked by the caller.
  const unit = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
  const edits: OffsetEdit[] = [];
  const replace = (start: number, end: number, newText: string): void => {
    if (text.slice(start, end) !== newText) edits.push({ start, end, newText });
  };

  // Spans whose inside is not menu white space: from the opening quote or backtick to the closing one.
  // Strings and blocks never overlap (the lexer reads them one after the other), so sorted by
  // start they are also sorted by end, and one binary search finds the span around an offset.
  const opaque: Span[] = [
    ...lexed.tokens.filter((token) => token.type === 'string' && token.quote !== undefined).map((token) => ({ start: token.start, end: token.end - 1 })),
    ...lexed.inline.map((block) => ({ start: block.start, end: block.close })),
  ].sort((a, b) => a.start - b.start);
  /** Whether `offset` lies after the opening delimiter of a string or `` `…` `` block, up to its closing one. */
  const within = (offset: number): boolean => {
    const span = opaque[lastStartingBefore(opaque, (span) => span.start, offset)];
    return span !== undefined && offset <= span.end;
  };

  // Depth of the `{ … }` blocks open at each line start, and the closers that lead each line.
  const braces = lexed.tokens.filter((token) => token.type === '{' || token.type === '}');
  const depthAtLine: number[] = [];
  {
    let depth = 0;
    let next = 0;
    for (let line = 0; line < starts.length; line++) {
      const lineStart = starts[line] ?? 0;
      for (let brace = braces[next]; brace !== undefined && brace.start < lineStart; brace = braces[++next]) {
        depth = brace.type === '{' ? depth + 1 : Math.max(0, depth - 1);
      }
      // `}` tokens that lead the line, separated by white space only.
      let leading = 0;
      let position = lineStart;
      while (isHorizontal(text[position])) position++;
      for (let k = next; braces[k]?.type === '}' && braces[k]?.start === position; k++) {
        leading++;
        position++;
        while (isHorizontal(text[position])) position++;
      }
      depthAtLine.push(Math.max(0, depth - leading));
    }
  }

  // The embedded Lua.
  const chunks: ChunkLayout[] = [];
  let unformatted = 0;
  for (const { chunk, tree } of parsed.chunks) {
    const quoted = chunk.region.end - chunk.region.start > chunk.text.length;
    const closer = quoted ? chunk.region.end - 1 : undefined;
    // One level deeper than the line where the chunk starts, except for `` ` `` blocks outside
    // any `{ … }` block: they hold a file's top-level Lua, at level 0 as in a Lua file.
    const openerDepth = depthAtLine[lineAt(starts, chunk.region.start)] ?? 0;
    const baseLevel = chunk.origin === 'block' && openerDepth === 0 ? 0 : openerDepth + 1;
    const result = formatEmbedded(text, tree, options, baseLevel);
    if (!result.ok) {
      if (result.reason !== 'syntax-error') return undefined;
      unformatted++;
      chunks.push({ region: chunk.region, closer, formatted: false });
      continue;
    }
    edits.push(...result.edits);
    chunks.push({ region: chunk.region, closer, formatted: true });
  }

  // Lines that start outside any string or Lua block, and the closing lines of formatted chunks.
  for (let line = 0; line < starts.length; line++) {
    const lineStart = starts[line] ?? 0;
    const lineEnd = starts[line + 1] ?? text.length;
    let contentStart = lineStart;
    while (contentStart < lineEnd && isHorizontal(text[contentStart])) contentStart++;
    const breakAt = text.slice(lineStart, lineEnd).search(/[\r\n]/);
    const contentEnd = breakAt < 0 ? lineEnd : lineStart + breakAt;
    const blank = contentStart === contentEnd;
    if (within(lineStart)) {
      // The line starts inside a string or a Lua block. Only the closing line of a formatted
      // chunk is the menu's: from its closing backtick or quote on.
      // Chunks are in document order and never overlap.
      const candidate = chunks[lastStartingBefore(chunks, (c) => c.region.start, lineStart)];
      const chunk = candidate && lineStart < candidate.region.end ? candidate : undefined;
      if (chunk?.formatted !== true || chunk.closer !== contentStart) continue;
      replace(lineStart, contentStart, unit.repeat(depthAtLine[lineAt(starts, chunk.region.start)] ?? 0));
    } else {
      replace(lineStart, contentStart, blank ? '' : unit.repeat(depthAtLine[line] ?? 0));
    }
    // Trailing white space, unless the line ends inside a string or a Lua block.
    if (!blank && !within(contentEnd)) {
      let trailing = contentEnd;
      while (trailing > contentStart && isHorizontal(text[trailing - 1])) trailing--;
      replace(trailing, contentEnd, '');
    }
  }

  // A formatted `` `…` `` block whose dropped last character is a line break: the line before it ends
  // the Lua text, so `formatEmbedded` kept its trailing white space; it is trailing white space of a line.
  for (const [index, { chunk, tree }] of parsed.chunks.entries()) {
    // `chunks` holds one layout per parsed chunk, in the same order.
    if (chunk.origin !== 'block' || chunks[index]?.formatted !== true) continue;
    if (text[tree.end] !== '\n' && text[tree.end] !== '\r') continue;
    let trailing = tree.end;
    while (isHorizontal(text[trailing - 1])) trailing--;
    replace(trailing, tree.end, '');
  }

  if (finalNewlines) finalNewlineEdits(text, options, edits);
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  return { edits, unformatted, chunks };
}

/** Edits for `insertFinalNewline` and `trimFinalNewlines` after the last character that is not white space. */
function finalNewlineEdits(text: string, options: FormattingOptions, edits: OffsetEdit[]): void {
  let contentEnd = text.length;
  while (contentEnd > 0 && /\s/.test(text[contentEnd - 1] ?? '')) contentEnd--;
  if (contentEnd === 0) return;
  const tail = text.slice(contentEnd);
  const breaks = tail.match(/\r\n|\r|\n/g) ?? [];
  if (breaks.length === 0) {
    if (options.insertFinalNewline === true) edits.push({ start: text.length, end: text.length, newText: endOfLine(text) });
  } else if (options.trimFinalNewlines === true && breaks.length > 1) {
    // Keep the first line break; the lines after it are blank, and their white space goes too.
    const first = /\r\n|\r|\n/.exec(tail);
    // `breaks.length > 1`, so the tail has a line break.
    const firstEnd = contentEnd + (first?.index ?? 0) + (first?.[0].length ?? 0);
    // Blank lines' white space was already emptied by the line loop, except on the last line.
    const removed = { start: firstEnd, end: text.length, newText: '' };
    for (let i = edits.length - 1; i >= 0; i--) {
      const edit = edits[i];
      if (edit !== undefined && edit.start >= firstEnd) edits.splice(i, 1);
    }
    edits.push(removed);
  }
}

/** The menu tokens, problems and Lua of a text, in a form two texts can be compared by. */
function fingerprint(text: string, lexed: MenuLexResult, extraction: MenuExtraction, runtime: Runtime): string[] {
  const luaRegions = new Set(extraction.chunks.map((chunk) => chunk.region.start));
  const tokens = lexed.tokens.map((token) =>
    // A Lua string is compared by its Lua tokens below.
    luaRegions.has(token.start) ? `${token.type}${token.quote ?? ''}:lua` : `${token.type}:${text.slice(token.start, token.end)}`,
  );
  const lua = extraction.chunks.map((chunk) => {
    const lexedLua: LexResult = lex(text, chunk.offset, chunk.offset + chunk.text.length, runtime);
    return [
      `${chunk.kind}/${chunk.origin}/${chunk.forms.map((form) => `${form.prefix}|${form.suffix}`).join(',')}`,
      ...lexedLua.tokens.map((token) => `${token.type}:${token.value}`),
      ...lexedLua.comments.map((comment) => {
        const raw = text.slice(comment.start, comment.end);
        return `--${comment.long ? raw : raw.replace(/[ \t\v\f]+$/, '')}`;
      }),
      `errors:${lexedLua.errors.length}`,
    ].join('\n');
  });
  const problems = [...lexed.problems, ...extraction.problems].map((problem) => problem.code);
  return [...tokens, '--lua--', ...lua, '--problems--', ...problems, `inline:${lexed.inline.length}`];
}

/** Content lines: the line breaks before the last character that is not white space. */
function contentLines(text: string): number {
  return lineStarts(text.trimEnd()).length;
}

function checked(parsed: ParsedDocument, lexed: MenuLexResult, edits: readonly OffsetEdit[], unformatted: number): MenuFormatResult {
  for (let i = 1; i < edits.length; i++) {
    const previous = edits[i - 1];
    const edit = edits[i];
    if (previous !== undefined && edit !== undefined && edit.start < previous.end) return { ok: false, reason: 'unsafe' };
  }
  const formatted = applyEdits(parsed.text, edits);
  const before = fingerprint(parsed.text, lexed, extractMenuLua(parsed.text), parsed.runtime);
  const afterLexed = lexMenu(formatted);
  const after = fingerprint(formatted, afterLexed, extractMenuLua(formatted), parsed.runtime);
  const same = before.length === after.length && before.every((item, i) => item === after[i]);
  return same && contentLines(parsed.text) === contentLines(formatted) ? { ok: true, edits, unformatted } : { ok: false, reason: 'unsafe' };
}

function prepared(parsed: ParsedDocument, options: FormattingOptions): { lexed: MenuLexResult } | MenuFormatResult {
  if (!validOptions(options)) return { ok: false, reason: 'invalid-options' };
  const lexed = lexMenu(parsed.text);
  if (unterminated(lexed)) return { ok: false, reason: 'syntax-error' };
  return { lexed };
}

/** Formats a whole .menu document. */
export function formatMenuDocument(parsed: ParsedDocument, options: FormattingOptions): MenuFormatResult {
  const ready = prepared(parsed, options);
  if (!('lexed' in ready)) return ready;
  const result = layout(parsed, ready.lexed, options, true);
  if (result === undefined) return { ok: false, reason: 'unsafe' };
  return checked(parsed, ready.lexed, result.edits, result.unformatted);
}

/**
 * The edits of the document within `[from, to)`. An insertion at `to` belongs to the
 * next line (its indentation) and is not kept. `unformatted` counts the chunks with a
 * syntax error that overlap the span.
 */
function formatSpan(parsed: ParsedDocument, options: FormattingOptions, from: number, to: number, keep?: (edit: OffsetEdit) => boolean): MenuFormatResult {
  const ready = prepared(parsed, options);
  if (!('lexed' in ready)) return ready;
  const result = layout(parsed, ready.lexed, options, false);
  if (result === undefined) return { ok: false, reason: 'unsafe' };
  const edits = result.edits.filter((edit) => edit.start >= from && edit.start < to && edit.end <= to && (keep?.(edit) ?? true));
  const unformatted = result.chunks.filter((chunk) => !chunk.formatted && chunk.region.start < to && chunk.region.end > from).length;
  return checked(parsed, ready.lexed, edits, unformatted);
}

/**
 * Formats the whole lines that `[start, end)` touches (a range that ends at the start
 * of a line does not include that line).
 */
export function formatMenuRange(parsed: ParsedDocument, options: FormattingOptions, start: number, end: number): MenuFormatResult {
  const starts = lineStarts(parsed.text);
  const firstLine = lineAt(starts, start);
  let lastLine = lineAt(starts, end);
  if (lastLine > firstLine && starts[lastLine] === end) lastLine--;
  return formatSpan(parsed, options, starts[firstLine] ?? 0, starts[lastLine + 1] ?? parsed.text.length);
}

/**
 * On-type formatting after `character` was typed and the cursor is at `offset`, with
 * the same triggers as Lua files (format.ts `formatOnType`):
 * - A line break: formats the line it ended, and indents the new line when it has
 *   text after the cursor (a blank new line keeps the editor's indentation).
 * - In Lua, the last character of a closer (`end`, `)`, …) that is the first token of
 *   its line; outside Lua, a `}` that is the first character of its line: indents that
 *   line. Anything else: no edits.
 */
export function formatMenuOnType(parsed: ParsedDocument, options: FormattingOptions, offset: number, character: string): MenuFormatResult {
  const { text } = parsed;
  const starts = lineStarts(text);
  const line = lineAt(starts, offset);
  const lineStart = starts[line] ?? 0;
  const lineEnd = starts[line + 1] ?? text.length;
  const none: MenuFormatResult = { ok: true, edits: [], unformatted: 0 };
  if (character === ON_TYPE_FIRST_TRIGGER) {
    if (line === 0) return none;
    const blank = text.slice(lineStart, lineEnd).trim() === '';
    return formatSpan(parsed, options, starts[line - 1] ?? 0, lineEnd, (edit) => !(blank && edit.start >= lineStart));
  }
  const chunk = parsed.chunks.find(({ tree }) => tree.start <= lineStart && offset <= tree.end);
  if (chunk !== undefined) {
    const closer = typedCloser(text, chunk.tree, lineStart, offset, character);
    return closer === undefined ? none : formatSpan(parsed, options, lineStart, closer);
  }
  if (character !== '}' || text[offset - 1] !== '}' || text.slice(lineStart, offset - 1).trim() !== '') return none;
  const lexed = lexMenu(text);
  if (!lexed.tokens.some((token) => token.type === '}' && token.end === offset)) return none;
  return formatSpan(parsed, options, lineStart, offset);
}
