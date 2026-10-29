// What each name of a document is, for semantic highlighting. Pure: no LSP or
// `vscode` imports.
//
// Only names are classified; keywords, literals, comments and .menu syntax are
// left to the TextMate grammars. Names follow the rules of hover
// (hover/resolve.ts), so a name is colored as it hovers:
//
// - Locals: `parameter` for parameters and the implicit `self` (manual
//   §3.4.10, "an extra parameter called self"); `function` for `local function
//   f` and for a local declared with a function expression and never assigned
//   again; `variable` otherwise. The declaring name has `declaration`.
// - Globals have `global`. A global the document assigns is a `function` when
//   its first assignment gives it a function, a `variable` otherwise. Other
//   globals take their kind from the Lua 5.2 manual (`namespace` for module
//   tables) or EEex-Docs (`function`), with `defaultLibrary` for the manual's
//   names, the engine's `print` and the EE Game Lua Functions; EEex functions
//   are a separate mod and do not get it.
// - `_ENV`, and names resolved through a local `_ENV`, are fields of a table
//   (manual §2.2): `variable` without `global`.
// - Field names: `property`, `method` after `:`; a library or EEex-Docs
//   member takes its kind from the documentation, as in hover. The names after
//   the first in `function a.b:m()` are a `property` path ending in a
//   `function` or `method`; named keys of table constructors are a declared
//   `property`.
// - Labels (`::name::`, `goto name`): `label`.
// - Assignment targets have `modification`.

import type * as Ast from '../syntax/ast.ts';
import type { ParsedDocument } from '../syntax/document.ts';
import type { ExternalEntry, ManualEntry } from '../hover/knowledge.ts';
import { memberTarget, variableTarget, type HoverTarget } from '../hover/resolve.ts';
import { globalPath, withoutG } from '../syntax/globalPaths.ts';
import { memberIndex } from '../syntax/members.ts';
import { variableIndex } from '../syntax/navigation.ts';
import type { Declaration } from '../syntax/scope.ts';
import { declarationSite } from '../syntax/signatures.ts';
import { walk } from '../syntax/walk.ts';

export const TOKEN_TYPES = ['namespace', 'function', 'method', 'variable', 'parameter', 'property', 'label'] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

/** `global` is not a standard modifier: the extension manifest declares it (`semanticTokenModifiers`). */
export const TOKEN_MODIFIERS = ['declaration', 'modification', 'defaultLibrary', 'global'] as const;
export type TokenModifier = (typeof TOKEN_MODIFIERS)[number];

/** A classified name: `[start, end)` document offsets, never spanning lines. */
export interface NameToken {
  readonly start: number;
  readonly end: number;
  readonly type: TokenType;
  readonly modifiers: readonly TokenModifier[];
}

/** EEex-Docs section whose functions the engine itself provides (see hover/knowledge.ts). */
const ENGINE_SOURCE = 'EE Game Lua Functions';

type Kind = Pick<NameToken, 'type' | 'modifiers'>;

function manualKind(entry: ManualEntry): Kind {
  const type: TokenType = entry.kind === 'module' ? 'namespace' : entry.kind === 'function' ? 'function' : 'variable';
  return { type, modifiers: ['defaultLibrary'] };
}

function externalKind(entry: ExternalEntry): Kind {
  return { type: 'function', modifiers: entry.sourceTitle === ENGINE_SOURCE ? ['defaultLibrary'] : [] };
}

const isFunction = (expression: Ast.Expression | undefined): boolean => expression?.kind === 'FunctionExpression';

function localKind(document: ParsedDocument, declaration: Declaration, writes: ReadonlySet<Ast.Identifier>): TokenType {
  switch (declaration.kind) {
    case 'parameter':
    case 'self':
      return 'parameter';
    case 'localFunction':
      return 'function';
    case 'forVariable':
      return 'variable';
    case 'local': {
      const site = declaration.identifier && declarationSite(document, declaration.identifier);
      const constant = !declaration.references.some((reference) => writes.has(reference));
      return site?.kind === 'local' && isFunction(site.value) && constant ? 'function' : 'variable';
    }
  }
}

/** The kind of a name hover describes as `target` (not a local). */
function documentedKind(target: HoverTarget): Kind | undefined {
  switch (target.kind) {
    case 'global': {
      const site = target.site;
      const assignsFunction = site?.kind === 'functionDeclaration' || (site?.kind === 'assignment' && isFunction(site.value));
      return { type: assignsFunction ? 'function' : 'variable', modifiers: [] };
    }
    case 'library':
      return manualKind(target.entry);
    case 'engineReplaced':
      return { type: 'function', modifiers: ['defaultLibrary'] };
    case 'external':
      return externalKind(target.entry);
    case 'local':
      return undefined;
  }
}

/** Classified names of each document; dropped with the document. */
const caches = new WeakMap<ParsedDocument, readonly NameToken[]>();

/** Every name of the document with its classification, sorted by offset. Never throws. */
export function classifyNames(document: ParsedDocument): readonly NameToken[] {
  let tokens = caches.get(document);
  if (!tokens) {
    tokens = classify(document);
    caches.set(document, tokens);
  }
  return tokens;
}

function classify(document: ParsedDocument): NameToken[] {
  const tokens: NameToken[] = [];
  const add = (identifier: Ast.Identifier, type: TokenType, ...modifiers: (TokenModifier | false)[]): void => {
    tokens.push({ start: identifier.start, end: identifier.end, type, modifiers: modifiers.filter((modifier) => modifier !== false) });
  };
  /** A global's classification depends only on its name; resolving it scans every chunk, so once per name. */
  const globals = new Map<string, Kind>();

  for (const hit of variableIndex(document)) {
    const { identifier, chunkIndex } = hit;
    const scopes = document.chunks[chunkIndex]?.scopes;
    if (!scopes) continue;
    const modification = scopes.writes.has(identifier) && 'modification';
    const declaration = scopes.resolved.get(identifier);
    if (declaration) {
      add(identifier, localKind(document, declaration, scopes.writes), declaration.identifier === identifier && 'declaration', modification);
      continue;
    }
    if (scopes.environmentFields.has(identifier) || identifier.name === '_ENV') {
      add(identifier, 'variable', modification);
      continue;
    }
    let kind = globals.get(identifier.name);
    if (!kind) {
      const target = variableTarget(document, { identifier, chunkIndex, target: { kind: 'global', name: identifier.name } });
      kind = (target && documentedKind(target)) ?? { type: 'variable', modifiers: [] };
      globals.set(identifier.name, kind);
    }
    add(identifier, kind.type, ...kind.modifiers, modification, 'global');
  }

  /** Field names that `t.x = …` assigns. */
  const assigned = new Set<Ast.Identifier>();
  document.chunks.forEach(({ tree }) => {
    walk(tree.body, (node) => {
      switch (node.kind) {
        case 'AssignmentStatement':
          for (const target of node.targets) if (target.kind === 'MemberExpression') assigned.add(target.member);
          break;
        case 'FunctionDeclaration': {
          // The first name is a variable (above); the rest name fields.
          const fields = node.path.slice(1);
          fields.forEach((field, i) => {
            const last = i === fields.length - 1 && !node.method;
            add(field, last ? 'function' : 'property', last && 'modification');
          });
          if (node.method) add(node.method, 'method', 'modification');
          break;
        }
        case 'LabelStatement':
          add(node.label, 'label', 'declaration');
          break;
        case 'GotoStatement':
          add(node.label, 'label');
          break;
        case 'TableConstructor':
          for (const field of node.fields) {
            if (field.form === 'named' && field.key?.kind === 'Identifier') add(field.key, 'property', 'declaration');
          }
          break;
        default:
          break;
      }
    });
  });

  for (const occurrence of memberIndex(document)) {
    const { identifier, node, chunkIndex } = occurrence;
    const target = memberTarget(document, occurrence);
    const modification = assigned.has(identifier) && 'modification';
    // Only library and EEex-Docs members, and globals named through `_G.x`, are documented.
    const documented = target && documentedKind(target);
    const isMethod = node.kind === 'MethodCallExpression';
    if (!documented) {
      add(identifier, isMethod ? 'method' : 'property', modification);
      continue;
    }
    const path = isMethod ? undefined : globalPath(document, chunkIndex, node);
    const isGlobal = path !== undefined && withoutG(path).length === 1;
    add(identifier, isMethod ? 'method' : documented.type, ...documented.modifiers, modification, isGlobal && 'global');
  }

  return tokens.sort((a, b) => a.start - b.start);
}
