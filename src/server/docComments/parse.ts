// LuaCATS doc comments (https://luals.github.io/wiki/annotations/): the lines of
// one `---` comment block, parsed into a description and tags. Pure: no LSP or
// `vscode` imports. Types are kept as written; nothing here checks them.
//
// The annotation reference fixes the syntax of each tag; where it is silent this
// module follows its examples, and says so:
//
// - A tag line is `---@<tag> …` with no space before `@`, as in every example.
//   `--- @param` stays description text.
// - Any other line is description (Markdown, "most of the markdown syntax"),
//   with one leading space removed, so `--- Text` is `Text`. An empty `---`
//   line is an empty line, which separates paragraphs.
// - `---|` lines continue the values of the tag above them (`---|"'immediate'"`);
//   they are not description and are not rendered.

/** One line of a doc block: the text after `---`, and the document offset of its first character. */
export interface DocLine {
  readonly text: string;
  readonly start: number;
}

/** A half-open document range `[start, end)`. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** `---@param <name[?]> <type[|type...]> [description]`. */
export interface DocParam {
  /** The name as written without `?`: a Lua name or `...`. */
  readonly name: string;
  readonly optional: boolean;
  readonly type: string;
  /** Kept verbatim (trimmed). */
  readonly description: string;
  readonly nameSpan: Span;
}

/** `---@return <type> [<name> [comment] | [name] #<comment>]`. */
export interface DocReturn {
  readonly type: string;
  readonly name: string | undefined;
  readonly description: string;
}

/** A tag in the order written, for rendering. */
export type DocTag =
  | { readonly tag: 'param'; readonly param: DocParam }
  | { readonly tag: 'return'; readonly value: DocReturn }
  | { readonly tag: 'type'; readonly type: string }
  | { readonly tag: 'deprecated' }
  | { readonly tag: 'see'; readonly symbol: string };

/** Why a tag line is incomplete. */
export type MalformedReason = 'paramName' | 'paramType' | 'type';

export interface MalformedTag {
  /** The tag name as written, with `@` (`@param`). */
  readonly tag: string;
  readonly reason: MalformedReason;
  /** From `@` to the end of the line's text, trailing white space excluded. */
  readonly span: Span;
}

export interface DocComment {
  /** The description lines joined with `\n`; empty when there are none. */
  readonly description: string;
  /** The rendered tags in source order (`@param`, `@return`, `@type`, `@deprecated`, `@see`). */
  readonly tags: readonly DocTag[];
  readonly params: readonly DocParam[];
  readonly malformed: readonly MalformedTag[];
}

/** The tags of the annotation reference. Lines of the others are recognised, but not rendered. */
export const LUACATS_TAGS: ReadonlySet<string> = new Set([
  'alias', 'as', 'async', 'cast', 'class', 'deprecated', 'diagnostic', 'enum', 'field', 'generic', 'meta', 'module',
  'nodiscard', 'operator', 'overload', 'package', 'param', 'private', 'protected', 'return', 'see', 'source', 'type',
  'vararg', 'version',
]);

const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\t';
const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;
const CLOSING: Readonly<Record<string, string>> = { '(': ')', '<': '>', '{': '}', '[': ']' };

function skipSpaces(text: string, i: number): number {
  while (isSpace(text[i])) i++;
  return i;
}

/**
 * The end of the type that starts at `from`. A type runs through balanced
 * `()`, `<>`, `{}`, `[]` and quoted strings. White space outside them ends it,
 * except around `|` (`string | nil`), after the `):` of a function type and
 * after a `,` in its return list (`fun(a: integer): string, boolean`).
 */
export function scanType(text: string, from: number): number {
  const open: string[] = [];
  let functionReturns = false;
  let i = from;
  while (i < text.length) {
    const c = text[i] ?? '';
    if (c === '"' || c === "'" || c === '`') {
      const close = text.indexOf(c, i + 1);
      i = close < 0 ? text.length : close + 1;
      continue;
    }
    if (c in CLOSING) {
      open.push(CLOSING[c] ?? '');
    } else if (open.length > 0 && c === open[open.length - 1]) {
      open.pop();
    } else if (open.length === 0) {
      if (c === ':' && text[i - 1] === ')') functionReturns = true;
      if (isSpace(c)) {
        const next = skipSpaces(text, i);
        const previous = text[i - 1];
        const continues = next < text.length && (previous === '|' || text[next] === '|' || (functionReturns && (previous === ':' || previous === ',')));
        if (!continues) break;
        i = next;
        continue;
      }
    }
    i++;
  }
  return i;
}

/** The type at `from` (after white space), and where it ends; an empty type when there is none. */
function typeAt(text: string, from: number): { readonly type: string; readonly end: number } {
  const start = skipSpaces(text, from);
  const end = scanType(text, start);
  return { type: text.slice(start, end), end };
}

/** `name` or `...` at `from`, with an optional `?`; `undefined` when there is none. */
function paramName(text: string, from: number): { readonly name: string; readonly optional: boolean; readonly start: number; readonly end: number } | undefined {
  const rest = text.slice(from);
  const name = rest.startsWith('...') ? '...' : NAME.exec(rest)?.[0];
  if (name === undefined) return undefined;
  const optional = text[from + name.length] === '?';
  return { name, optional, start: from, end: from + name.length + (optional ? 1 : 0) };
}

function parseReturn(text: string, from: number): DocReturn {
  const { type, end } = typeAt(text, from);
  let rest = text.slice(end).trim();
  let name: string | undefined;
  if (!rest.startsWith('#')) {
    const written = rest.startsWith('...') ? '...' : NAME.exec(rest)?.[0];
    // A name is a whole word: `boolean ok # …`, `string ...`.
    if (written !== undefined && (rest.length === written.length || isSpace(rest[written.length]))) {
      name = written;
      rest = rest.slice(written.length).trim();
    }
  }
  const description = rest.startsWith('#') ? rest.slice(1).trim() : rest;
  return { type, name, description };
}

/** Parses the lines of one doc block. */
export function parseDocComment(lines: readonly DocLine[]): DocComment {
  const description: string[] = [];
  const tags: DocTag[] = [];
  const params: DocParam[] = [];
  const malformed: MalformedTag[] = [];
  for (const { text, start } of lines) {
    if (text.startsWith('|')) continue;
    if (!text.startsWith('@')) {
      description.push(isSpace(text[0]) ? text.slice(1) : text);
      continue;
    }
    const tag = /^@([A-Za-z_]*)/.exec(text)?.[1] ?? '';
    const afterTag = 1 + tag.length;
    const span: Span = { start, end: start + text.trimEnd().length };
    const fail = (reason: MalformedReason): void => {
      malformed.push({ tag: `@${tag}`, reason, span });
    };
    switch (tag) {
      case 'param': {
        const nameAt = skipSpaces(text, afterTag);
        const name = nameAt > afterTag ? paramName(text, nameAt) : undefined;
        if (!name) {
          fail('paramName');
          break;
        }
        const { type, end } = isSpace(text[name.end]) ? typeAt(text, name.end) : { type: '', end: name.end };
        if (!type) {
          fail('paramType');
          break;
        }
        const param: DocParam = {
          name: name.name,
          optional: name.optional,
          type,
          description: text.slice(end).trim(),
          nameSpan: { start: start + name.start, end: start + name.end - (name.optional ? 1 : 0) },
        };
        params.push(param);
        tags.push({ tag: 'param', param });
        break;
      }
      case 'return': {
        const value = isSpace(text[afterTag]) ? parseReturn(text, afterTag) : undefined;
        if (!value?.type) {
          fail('type');
          break;
        }
        tags.push({ tag: 'return', value });
        break;
      }
      case 'type': {
        const type = isSpace(text[afterTag]) ? typeAt(text, afterTag).type : '';
        if (!type) {
          fail('type');
          break;
        }
        tags.push({ tag: 'type', type });
        break;
      }
      case 'deprecated':
        tags.push({ tag: 'deprecated' });
        break;
      case 'see': {
        const symbol = text.slice(afterTag).trim();
        if (symbol) tags.push({ tag: 'see', symbol });
        break;
      }
      default:
        // Other LuaCATS tags, and unknown ones: not rendered, never description.
        break;
    }
  }
  return { description: trimBlankLines(description).join('\n'), tags, params, malformed };
}

/** `lines` without leading and trailing empty lines. */
function trimBlankLines(lines: readonly string[]): string[] {
  let first = 0;
  let last = lines.length;
  while (first < last && lines[first]?.trim() === '') first++;
  while (last > first && lines[last - 1]?.trim() === '') last--;
  return lines.slice(first, last);
}
