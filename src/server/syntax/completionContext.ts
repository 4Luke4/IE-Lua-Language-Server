// What kind of name can be typed at a position, for completion. Pure: no LSP
// or `vscode` imports.
//
// The context comes from the tokens before the cursor, not from the syntax
// tree: the statement being typed is usually incomplete, and the parser
// abandons it. Only the Lua chunks of a document are considered (in a .menu
// file, the Lua the engine compiles); anything else has no context.
//
// - Inside a comment, a string or a number: none.
// - Where a name is declared rather than used: none. That is after `local`,
//   `function`, `for`, `goto` and an opening `::`, after `,` in the name lists
//   of `local` and `for`, and in the parameter list of a function.
// - After `.` or `:` that follow a chain of names (`a.b.`, `a.b:`): a member of
//   that chain. Chains that start at anything else (a call, an index, a
//   string) are not followed, except `("…"):`, a method of the string library.
// - Anywhere else: a variable (or a keyword).

import type { ParsedChunk, ParsedDocument } from './document.ts';
import { lex, type Comment, type ParseError, type Token } from './lexer.ts';

export type CompletionContext =
  /** A variable or keyword. */
  | { readonly kind: 'variable' }
  /** A field (`.`) or method (`:`) of the chain `path` (`['_G', 'string']` for `_G.string.`). */
  | { readonly kind: 'member'; readonly path: readonly string[]; readonly operator: '.' | ':' }
  /** A method of a string literal, `("…"):`. */
  | { readonly kind: 'stringMethod' };

export interface CompletionSite {
  readonly context: CompletionContext;
  /** Index in `ParsedDocument.chunks` of the chunk the cursor is in. */
  readonly chunkIndex: number;
  /** The chunk is an expression (a .menu value such as `enabled "…"`), not statements. */
  readonly expression: boolean;
  /** Offset of the start of the name being typed; the cursor when none is. */
  readonly start: number;
  /** End of the name around the cursor: a completion replaces `[start, end)`. */
  readonly end: number;
  /** The part of the name before the cursor. */
  readonly prefix: string;
}

const isNameCharacter = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c);

const isSymbol = (token: Token | undefined, value: string): boolean => token?.type === 'symbol' && token.value === value;
const isKeyword = (token: Token | undefined, value: string): boolean => token?.type === 'keyword' && token.value === value;

/** Whether the cursor is inside a comment that `lex` cut at the cursor (`to`). */
function inComment(comments: readonly Comment[], errors: readonly ParseError[], offset: number): boolean {
  const last = comments.at(-1);
  if (last?.end !== offset) return false;
  // A `--` comment runs to the end of the line; a long one only until it is closed.
  return !last.long || errors.some((error) => error.start >= last.start && error.start < last.end && error.message === 'unfinished long comment');
}

/**
 * Whether `tokens[index]` is the `(` of a parameter list: preceded by
 * `function`, or by `function a.b:c`.
 */
function isParameterListOpen(tokens: readonly Token[], index: number): boolean {
  let i = index - 1;
  if (isKeyword(tokens[i], 'function')) return true;
  if (tokens[i]?.type !== 'name') return false;
  i--;
  while ((isSymbol(tokens[i], '.') || isSymbol(tokens[i], ':')) && tokens[i - 1]?.type === 'name') i -= 2;
  return isKeyword(tokens[i], 'function');
}

/** Whether a name typed after `tokens[index]` declares a variable, a label or a parameter. */
function isDeclaration(tokens: readonly Token[], index: number): boolean {
  const previous = tokens[index];
  if (isKeyword(previous, 'local') || isKeyword(previous, 'function') || isKeyword(previous, 'for') || isKeyword(previous, 'goto')) return true;
  // `::name::`: the first `::` opens a label; the second closes it.
  if (isSymbol(previous, '::')) return !(tokens[index - 1]?.type === 'name' && isSymbol(tokens[index - 2], '::'));
  if (isSymbol(previous, '(')) return isParameterListOpen(tokens, index);
  if (isSymbol(previous, ',')) {
    // Back over `a, b,` to what comes before the list.
    let i = index - 1;
    while (tokens[i]?.type === 'name' && isSymbol(tokens[i - 1], ',')) i -= 2;
    if (tokens[i]?.type !== 'name') return false;
    const before = tokens[i - 1];
    return isKeyword(before, 'local') || isKeyword(before, 'for') || (isSymbol(before, '(') && isParameterListOpen(tokens, i - 1));
  }
  return false;
}

/** The context after the `.` or `:` at `tokens[index]`, or `undefined` when there is none to offer. */
function memberContext(tokens: readonly Token[], index: number): CompletionContext | undefined {
  const operator = tokens[index]?.value === ':' ? ':' : '.';
  let i = index - 1;
  if (operator === ':' && isSymbol(tokens[i], ')') && tokens[i - 1]?.type === 'string' && isSymbol(tokens[i - 2], '(')) {
    return { kind: 'stringMethod' };
  }
  const path: string[] = [];
  for (;;) {
    const token = tokens[i];
    if (token?.type !== 'name') return undefined;
    path.unshift(token.value);
    if (!isSymbol(tokens[i - 1], '.')) break;
    i -= 2;
  }
  const before = tokens[i - 1];
  // `x:y.` is not Lua; `function a.b` names the function being declared.
  if (isSymbol(before, ':') || isKeyword(before, 'function')) return undefined;
  return { kind: 'member', path, operator };
}

/**
 * Where to start lexing for a cursor at `offset`: the start of the last
 * top-level statement of the chunk that starts before it and no later than
 * the first syntax error, else the chunk start. Such a statement was parsed
 * from the chunk start without errors, so it starts at a token of the whole
 * chunk (never inside a string or comment), and the tokens the context looks
 * back at belong to it or to later statements. After an error, the parser
 * resumes at likely statement starts, such as a name at the start of a line,
 * which may still be inside an expression (`t.` then `z` on the next line is
 * `t.z`), so those are not used. This keeps a request proportional to one
 * statement rather than to the file while the code above it parses.
 */
export function lexStart({ chunk, tree }: ParsedChunk, offset: number): number {
  const statements = tree.body.body;
  const limit = Math.min(offset - 1, tree.errors[0]?.start ?? Infinity);
  let low = 0;
  let high = statements.length - 1;
  let from = chunk.offset;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const statement = statements[middle];
    if (statement && statement.start <= limit) {
      from = Math.max(from, statement.start);
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return from;
}

/** The completion site at `offset` of a parsed document whose text is `text`, or `undefined` when nothing can be completed there. */
export function completionSiteAt(document: ParsedDocument, text: string, offset: number): CompletionSite | undefined {
  const chunkIndex = document.chunks.findIndex(({ chunk }) => chunk.offset <= offset && offset <= chunk.offset + chunk.text.length);
  const parsed = document.chunks[chunkIndex];
  if (!parsed) return undefined;
  return siteFrom(parsed, chunkIndex, text, offset, lexStart(parsed, offset));
}

/** `completionSiteAt` for the chunk `parsed`, lexing from `from` (exported for tests: from the chunk start, the result must be the same). */
export function siteFrom(parsed: ParsedChunk, chunkIndex: number, text: string, offset: number, from: number): CompletionSite | undefined {
  const { chunk } = parsed;
  const { tokens, comments, errors } = lex(text, from, offset);
  if (inComment(comments, errors, offset)) return undefined;
  tokens.pop(); // eof

  let previousIndex = tokens.length - 1;
  let start = offset;
  const last = tokens[previousIndex];
  if (last?.end === offset) {
    if (last.type === 'string' || last.type === 'number') return undefined;
    if (last.type === 'name' || last.type === 'keyword') {
      start = last.start;
      previousIndex--;
    }
  }
  if (isDeclaration(tokens, previousIndex)) return undefined;

  const previous = tokens[previousIndex];
  let context: CompletionContext | undefined = { kind: 'variable' };
  if (isSymbol(previous, '.') || isSymbol(previous, ':')) {
    context = memberContext(tokens, previousIndex);
  }
  if (!context) return undefined;

  let end = offset;
  const chunkEnd = chunk.offset + chunk.text.length;
  while (end < chunkEnd && isNameCharacter(text[end])) end++;
  return { context, chunkIndex, expression: chunk.kind === 'expression', start, end, prefix: text.slice(start, offset) };
}
