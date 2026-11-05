// LuaCATS doc comments as hover text. Pure: no LSP or `vscode` imports.
//
// The layout is the one VS Code's own TypeScript hovers give JSDoc
// (extensions/typescript-language-features/src/languageFeatures/util/textRendering.ts):
// the description, a blank line, then one paragraph per tag, labelled with the
// tag in italics (`*@param*`), its parameter name in a code span, and ` — ` before
// the text. Tag names are syntax, so they are not translated. LuaCATS adds types,
// which follow the name in a code span of their own. In plain text the same
// layout is written without markup.

import type { DocComment, DocParam, DocTag } from './parse.ts';

export type DocFormat = 'markdown' | 'plaintext';

/** `text` as a Markdown code span, with enough backticks that none inside closes it. */
export function codeSpan(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = '`'.repeat(longest + 1);
  // CommonMark strips one space from each end when both are spaces, and a
  // backtick at either end would join the fence.
  const pad = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ')) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** A tag line: the label, its code parts, then ` — ` and the text when there is one. */
function tagLine(tag: string, code: readonly string[], text: string, format: DocFormat): string {
  const label = format === 'markdown' ? `*@${tag}*` : `@${tag}`;
  const parts = [label, ...code.map((part) => (format === 'markdown' ? codeSpan(part) : part))].join(' ');
  return text ? `${parts} — ${text}` : parts;
}

/** The line of one `@param` entry. */
export function renderParam(param: DocParam, format: DocFormat): string {
  return tagLine('param', [param.optional ? `${param.name}?` : param.name, param.type], param.description, format);
}

function renderTag(tag: DocTag, format: DocFormat): string {
  switch (tag.tag) {
    case 'param':
      return renderParam(tag.param, format);
    case 'return': {
      const { type, name, description } = tag.value;
      return tagLine('return', name === undefined ? [type] : [type, name], description, format);
    }
    case 'type':
      return tagLine('type', [tag.type], '', format);
    case 'deprecated':
      return tagLine('deprecated', [], '', format);
    case 'see':
      return tagLine('see', [], tag.symbol, format);
  }
}

/** The description and tags of `doc`, or `undefined` when it has neither. */
export function renderDocComment(doc: DocComment, format: DocFormat): string | undefined {
  // VS Code ends each tag paragraph with a hard line break (`  \n\n`).
  const tags = doc.tags.map((tag) => renderTag(tag, format)).join(format === 'markdown' ? '  \n\n' : '\n');
  const parts = [doc.description, tags].filter((part) => part !== '');
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}
