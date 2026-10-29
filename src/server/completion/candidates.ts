// What completion offers at a completion site (see syntax/completionContext.ts).
// Pure: no LSP or `vscode` imports.
//
// Names come from the document and from what the server knows, by the rules
// of hover (hover/resolve.ts), so that a completed name hovers as offered:
//
// - Variables: the locals visible at the cursor (the innermost of each name),
//   then the globals the document assigns (in any Lua chunk of a .menu file),
//   then the Lua 5.2 library globals the engine opens, then the EEex and game
//   functions, then keywords. A name is offered once, from the first of these
//   that has it: a local hides a global, and a global the document assigns is
//   the document's, not the library's. While a local `_ENV` is visible, other
//   names are fields of that table: only locals and keywords are offered.
// - Keywords: the 22 reserved words (manual §3.1); in an expression chunk of
//   a .menu file, only those an expression can contain (manual §3.4: `nil`,
//   `false`, `true`, `function`, `not`, `and`, `or`).
// - `a.b.` and `a.b:` on a global (not on a local or a field of a local
//   `_ENV`), `_G.` prefixes removed: `_G.` offers the globals; `t.` and `t:`
//   the fields the document assigns on `t`; `string.`, `math.`, … the manual's
//   members unless the document assigns the module table itself, and except
//   members the document defines; EEex-Docs names (`EEex_Options_Option.new`
//   after `.`, `C:AddGold` after `:`).
// - `("…"):`: the string library (strings have it as their `__index`, manual
//   §6.4), except members the document defines.
//
// The manual data covers only the libraries the engine opens, so `io`, `os`,
// `require` and `coroutine` are never offered.

import type { HoverTarget } from '../hover/resolve.ts';
import {
  allExternalEntries,
  allManualEntries,
  engineReplacement,
  externalEntry,
  manualEntry,
  type ExternalEntry,
  type ManualEntry,
} from '../hover/knowledge.ts';
import type * as Ast from '../syntax/ast.ts';
import type { CompletionSite } from '../syntax/completionContext.ts';
import type { ParsedDocument } from '../syntax/document.ts';
import { fieldWrites, withoutG } from '../syntax/globalPaths.ts';
import { KEYWORDS } from '../syntax/lexer.ts';
import { definitions } from '../syntax/navigation.ts';
import { visibleAt, type Declaration } from '../syntax/scope.ts';
import { declarationSite, type DeclarationSite } from '../syntax/signatures.ts';

export type CandidateKind = 'function' | 'variable' | 'module' | 'field' | 'method' | 'keyword';

/**
 * Sort groups, in the order the variables rule lists the sources; editors
 * still rank by how well the typed text matches first.
 */
export const CandidateGroup = {
  Local: 0,
  Document: 1,
  Library: 2,
  External: 3,
  Keyword: 4,
} as const;
export type CandidateGroup = (typeof CandidateGroup)[keyof typeof CandidateGroup];

/** Where the documentation of a candidate comes from; looked up again by name when it is resolved. */
export interface DocumentationSource {
  readonly source: 'manual' | 'engineReplaced' | 'external';
  readonly name: string;
}

export interface Candidate {
  readonly label: string;
  readonly kind: CandidateKind;
  readonly group: CandidateGroup;
  /** What the name refers to, as a hover describes it (for the code line); `undefined` for keywords and document fields. */
  readonly target: HoverTarget | undefined;
}

/** Keywords that can appear in an expression (manual §3.4). */
const EXPRESSION_KEYWORDS: ReadonlySet<string> = new Set(['nil', 'false', 'true', 'function', 'not', 'and', 'or']);

const isFunctionValue = (site: DeclarationSite | undefined): boolean =>
  site?.kind === 'localFunction' || site?.kind === 'functionDeclaration' || ((site?.kind === 'local' || site?.kind === 'assignment') && site.value?.kind === 'FunctionExpression');

function localCandidate(document: ParsedDocument, declaration: Declaration): Candidate {
  const site = declaration.identifier && declarationSite(document, declaration.identifier);
  return {
    label: declaration.name,
    kind: isFunctionValue(site) ? 'function' : 'variable',
    group: CandidateGroup.Local,
    target: { kind: 'local', declaration, site },
  };
}

/** The target of a library global or member, as hover describes it. */
function libraryTarget(entry: ManualEntry): HoverTarget {
  const replacement = engineReplacement(entry.name);
  return replacement ? { kind: 'engineReplaced', replacement, entry } : { kind: 'library', entry };
}

function libraryKind(entry: ManualEntry, member: boolean): CandidateKind {
  if (entry.kind === 'function') return 'function';
  if (entry.kind === 'module') return 'module';
  return member ? 'field' : 'variable';
}

/** The last part of a documented name: `format` for `string.format`, `AddGold` for `C:AddGold`. */
const lastName = (name: string): string => name.slice(Math.max(name.lastIndexOf('.'), name.lastIndexOf(':')) + 1);

// The library and EEex-Docs names that are globals, built once.
const LIBRARY_GLOBALS: readonly Candidate[] = allManualEntries()
  .filter((entry) => !entry.name.includes('.'))
  .map((entry) => ({ label: entry.name, kind: libraryKind(entry, false), group: CandidateGroup.Library, target: libraryTarget(entry) }));
const EXTERNAL_GLOBALS: readonly Candidate[] = allExternalEntries()
  .filter((entry) => !/[.:]/.test(entry.name))
  .map((entry) => ({ label: entry.name, kind: 'function', group: CandidateGroup.External, target: { kind: 'external', entry } }));

/** Globals each document assigns, in document order; dropped with the document. */
const documentGlobalLists = new WeakMap<ParsedDocument, readonly Candidate[]>();

/** The globals the document assigns in any chunk (`x = …`, `function x()`), not fields of a local `_ENV`. */
function documentGlobals(document: ParsedDocument): readonly Candidate[] {
  let list = documentGlobalLists.get(document);
  if (!list) {
    // One pass in document order (chunks, then identifiers in source order). The
    // first write of each name is what hover describes (`definitions(…)[0]`).
    const firstWrites = new Map<string, Ast.Identifier>();
    const assigned = new Set<string>();
    for (const { scopes } of document.chunks) {
      for (const [name, identifiers] of scopes.globals) {
        for (const identifier of identifiers) {
          if (!scopes.writes.has(identifier)) continue;
          if (!firstWrites.has(name)) firstWrites.set(name, identifier);
          if (!scopes.environmentFields.has(identifier)) assigned.add(name);
        }
      }
    }
    list = [...assigned].map((name): Candidate => {
      const write = firstWrites.get(name);
      const site = write && declarationSite(document, write);
      return { label: name, kind: isFunctionValue(site) ? 'function' : 'variable', group: CandidateGroup.Document, target: { kind: 'global', name, site, link: externalEntry(name) } };
    });
    documentGlobalLists.set(document, list);
  }
  return list;
}

/** Adds each candidate whose label is not taken yet, in order. */
function addFirst(into: Map<string, Candidate>, candidates: Iterable<Candidate>): void {
  for (const candidate of candidates) {
    if (!into.has(candidate.label)) into.set(candidate.label, candidate);
  }
}

/** The globals, in the order of the variables rule. */
function globalCandidates(document: ParsedDocument, into: Map<string, Candidate>): void {
  addFirst(into, documentGlobals(document));
  addFirst(into, LIBRARY_GLOBALS);
  addFirst(into, EXTERNAL_GLOBALS);
}

function keywordCandidates(expression: boolean): Candidate[] {
  return [...KEYWORDS]
    .filter((keyword) => !expression || EXPRESSION_KEYWORDS.has(keyword))
    .map((keyword) => ({ label: keyword, kind: 'keyword', group: CandidateGroup.Keyword, target: undefined }));
}

/** The fields the document assigns on the global table `table` (see `fieldWrites`). */
function documentFields(document: ParsedDocument, table: string, kind: CandidateKind): Candidate[] {
  const prefix = `${table}.`;
  return [...fieldWrites(document)]
    .filter((dotted) => dotted.startsWith(prefix))
    .map((dotted) => ({ label: dotted.slice(prefix.length), kind, group: CandidateGroup.Document, target: undefined }));
}

/** The manual's members of `module` (`string.format`), except those the document defines. */
function libraryMembers(document: ParsedDocument, module: string): Candidate[] {
  const prefix = `${module}.`;
  const defined = fieldWrites(document);
  return allManualEntries()
    .filter((entry) => entry.name.startsWith(prefix) && !defined.has(entry.name))
    .map((entry) => ({ label: lastName(entry.name), kind: libraryKind(entry, true), group: CandidateGroup.Library, target: libraryTarget(entry) }));
}

/** EEex-Docs names one level below `dotted`, after `operator` (`EEex_Options_Option.new`, `C:AddGold`). */
function externalMembers(dotted: string, operator: '.' | ':'): Candidate[] {
  const prefix = `${dotted}${operator}`;
  return allExternalEntries()
    .filter((entry: ExternalEntry) => entry.name.startsWith(prefix) && !/[.:]/.test(entry.name.slice(prefix.length)))
    .map((entry) => ({ label: lastName(entry.name), kind: operator === ':' ? 'method' : 'function', group: CandidateGroup.External, target: { kind: 'external', entry } }));
}

/** Whether a local named `name` is visible at `offset` in the chunk. */
function hasVisibleLocal(document: ParsedDocument, chunkIndex: number, offset: number, name: string): boolean {
  const scopes = document.chunks[chunkIndex]?.scopes;
  return scopes !== undefined && visibleAt(scopes, offset).some((declaration) => declaration.name === name);
}

/** The candidates at a completion site, in group order, each label once. */
export function completionCandidates(document: ParsedDocument, site: CompletionSite): Candidate[] {
  const { context, chunkIndex, start } = site;
  const found = new Map<string, Candidate>();
  if (context.kind === 'variable') {
    const scopes = document.chunks[chunkIndex]?.scopes;
    const locals = scopes ? visibleAt(scopes, start) : [];
    addFirst(found, locals.map((declaration) => localCandidate(document, declaration)));
    if (!locals.some((declaration) => declaration.name === '_ENV')) globalCandidates(document, found);
    addFirst(found, keywordCandidates(site.expression));
    return [...found.values()];
  }
  if (context.kind === 'stringMethod') {
    addFirst(found, documentFields(document, 'string', 'method'));
    addFirst(found, libraryMembers(document, 'string').map((candidate) => ({ ...candidate, kind: candidate.kind === 'function' ? 'method' : candidate.kind })));
    return [...found.values()];
  }
  const [head = ''] = context.path;
  if (hasVisibleLocal(document, chunkIndex, start, head) || hasVisibleLocal(document, chunkIndex, start, '_ENV')) return [];
  const names = withoutG(context.path);
  const dotted = names.join('.');
  if (context.operator === '.' && dotted === '_G') {
    globalCandidates(document, found);
    return [...found.values()];
  }
  if (names.length === 1) {
    addFirst(found, documentFields(document, dotted, context.operator === ':' ? 'method' : 'field'));
    // A module table the document assigns itself is not the library's.
    if (context.operator === '.' && !definitions(document, { kind: 'global', name: dotted }).length) addFirst(found, libraryMembers(document, dotted));
  }
  addFirst(found, externalMembers(dotted, context.operator));
  return [...found.values()];
}

/** The documentation source of a candidate's target, if it has documentation to resolve. */
export function documentationSource(target: HoverTarget | undefined): DocumentationSource | undefined {
  switch (target?.kind) {
    case 'library':
      return { source: 'manual', name: target.entry.name };
    case 'engineReplaced':
      return { source: 'engineReplaced', name: target.replacement.name };
    case 'external':
      return { source: 'external', name: target.entry.name };
    case 'global':
      return target.link && { source: 'external', name: target.link.name };
    default:
      return undefined;
  }
}

/** The hover target whose documentation `value` (from a completion item's `data`) refers to; `undefined` for anything else. */
export function documentationTarget(value: unknown): HoverTarget | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { source, name } = value as Partial<Record<keyof DocumentationSource, unknown>>;
  if (typeof name !== 'string') return undefined;
  switch (source) {
    case 'manual': {
      const entry = manualEntry(name);
      return entry && { kind: 'library', entry };
    }
    case 'engineReplaced': {
      const replacement = engineReplacement(name);
      return replacement && { kind: 'engineReplaced', replacement, entry: manualEntry(name) };
    }
    case 'external': {
      const entry = externalEntry(name);
      return entry && { kind: 'external', entry };
    }
    default:
      return undefined;
  }
}
