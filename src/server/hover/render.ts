// Hover text for a hover target, in Markdown or plain text. Pure: no LSP or
// `vscode` imports.
//
// Layout: the name as Lua (a code block in Markdown), then the documentation,
// then where it comes from. Documentation quoted from the Lua manual is
// verbatim; only the server's own words (`parameter`, `global`, the note on
// engine replacements) are localized.

import type { Messages } from '../l10n.ts';
import type * as Ast from '../syntax/ast.ts';
import { parameterList, type DeclarationSite } from '../syntax/signatures.ts';
import { MANUAL_TITLE, type ExternalEntry, type ManualEntry } from './knowledge.ts';
import type { HoverTarget } from './resolve.ts';

export type HoverFormat = 'markdown' | 'plaintext';

/** `= function(a, b)` when `value` is a function expression, else nothing. */
function functionValue(value: Ast.Expression | undefined): string {
  return value?.kind === 'FunctionExpression' ? ` = function${parameterList(value)}` : '';
}

function localSignature(target: Extract<HoverTarget, { kind: 'local' }>, messages: Messages): string {
  const { declaration, site } = target;
  switch (declaration.kind) {
    case 'localFunction':
      return site?.kind === 'localFunction' ? `local function ${declaration.name}${parameterList(site.func)}` : `local function ${declaration.name}`;
    case 'local':
      return `local ${declaration.name}${site?.kind === 'local' ? functionValue(site.value) : ''}`;
    case 'parameter':
    case 'self':
      return `(${messages.t('hover.kind.parameter')}) ${declaration.name}`;
    case 'forVariable':
      return `(${messages.t('hover.kind.forVariable')}) ${declaration.name}`;
  }
}

function globalSignature(name: string, site: DeclarationSite | undefined, messages: Messages): string {
  const label = `(${messages.t('hover.kind.global')})`;
  if (site?.kind === 'functionDeclaration') return `${label} function ${name}${parameterList(site.func)}`;
  if (site?.kind === 'assignment') return `${label} ${name}${functionValue(site.value)}`;
  return `${label} ${name}`;
}

interface Link {
  readonly text: string;
  readonly url: string;
}

const manualLink = (entry: ManualEntry): Link => ({ text: `${MANUAL_TITLE}, §${entry.section.number} – ${entry.section.title}`, url: entry.url });
const externalLink = (entry: ExternalEntry): Link => ({ text: entry.sourceTitle, url: entry.url });

/** The parts of a hover, before formatting: code, documentation paragraphs (already in the format), source link. */
interface Parts {
  readonly code: string;
  readonly documentation?: string;
  readonly link?: Link;
}

function parts(target: HoverTarget, format: HoverFormat, messages: Messages): Parts {
  const linkText = (link: Link): string => (format === 'markdown' ? `[${link.text}](${link.url})` : `${link.text} (${link.url})`);
  switch (target.kind) {
    case 'local':
      return { code: localSignature(target, messages) };
    case 'global':
      return { code: globalSignature(target.name, target.site, messages), ...(target.link ? { link: externalLink(target.link) } : {}) };
    case 'library':
      return { code: target.entry.heading, documentation: format === 'markdown' ? target.entry.markdown : target.entry.plaintext, link: manualLink(target.entry) };
    case 'engineReplaced': {
      const { replacement, entry } = target;
      const source = linkText({ text: `IESDP: ${replacement.sourceTitle}`, url: replacement.url });
      const name = format === 'markdown' ? `\`${replacement.name}\`` : replacement.name;
      return { code: entry?.heading ?? replacement.name, documentation: messages.t('hover.engineReplaced', name, source) };
    }
    case 'external':
      return { code: target.entry.name, link: externalLink(target.entry) };
  }
}

/** The code line of a hover: how the target is declared or documented (`local function f(a)`, `string.format (formatstring, ···)`). */
export function renderSignature(target: HoverTarget, messages: Messages): string {
  // The code line is the same in both formats.
  return parts(target, 'plaintext', messages).code;
}

/** The parts after the code line, already formatted. */
function documentationParts({ documentation, link }: Parts, format: HoverFormat): string[] {
  const linkPart = link && (format === 'markdown' ? `[${link.text}](${link.url})` : `${link.text}: ${link.url}`);
  return [documentation, linkPart].filter((part) => part !== undefined);
}

const separator = (format: HoverFormat): string => (format === 'markdown' ? '\n\n---\n\n' : '\n\n');

/** A hover without its code line (the documentation and the source link), or `undefined` when there is neither. */
export function renderDocumentation(target: HoverTarget, format: HoverFormat, messages: Messages): string | undefined {
  const rest = documentationParts(parts(target, format, messages), format);
  return rest.length > 0 ? rest.join(separator(format)) : undefined;
}

/** The hover text for `target`. */
export function renderHover(target: HoverTarget, format: HoverFormat, messages: Messages): string {
  const hover = parts(target, format, messages);
  const code = format === 'markdown' ? `\`\`\`lua\n${hover.code}\n\`\`\`` : hover.code;
  return [code, ...documentationParts(hover, format)].join(separator(format));
}
