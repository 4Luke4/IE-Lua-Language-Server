// What a hover describes: the name under the cursor and what it refers to.
// Pure: no LSP or `vscode` imports.
//
// - A local: its declaration (`local function f(a)`, a parameter, …).
// - A global: shared by all chunks of a .menu file, as in navigation.ts.
//   1. Assigned in this document: described by its first assignment; the
//      document's own definition wins over the libraries (an EEex-Docs link is
//      still given, since a link makes no claim about behaviour).
//   2. Replaced by the engine (`print`): a note instead of the manual text.
//   3. In the manual (basic functions and the module tables string, table,
//      math, bit32, debug), then EEex-Docs.
//   4. Otherwise just a global, without documentation: also io, os, require
//      and coroutine, which the engine does not provide.
// - A field or method name: library and EEex-Docs names only (`string.format`,
//   `_G.string.format`, `("x"):rep()`, `C:AddGold()`, `EEex_Options_Option.new`).
//   Fields of anything else (locals, tables built in Lua) have no hover. As for
//   globals, a library member the document defines itself (`string.format = f`,
//   `function string.trim()`) is not described by the manual.
//
// Names resolved through a local `_ENV` are fields of that table, so they get
// no hover. Without type inference that is the only safe answer.

import type * as Ast from '../syntax/ast.ts';
import type { ParsedDocument } from '../syntax/document.ts';
import { fieldWrites, globalPath, withoutG } from '../syntax/globalPaths.ts';
import { memberAt, type MemberOccurrence } from '../syntax/members.ts';
import { definitions, targetAt, type TargetHit } from '../syntax/navigation.ts';
import type { Declaration } from '../syntax/scope.ts';
import { declarationSite, type DeclarationSite } from '../syntax/signatures.ts';
import { engineReplacement, externalEntry, manualEntry, type EngineReplacement, type ExternalEntry, type ManualEntry } from './knowledge.ts';

export type HoverTarget =
  | { readonly kind: 'local'; readonly declaration: Declaration; readonly site: DeclarationSite | undefined }
  /** A global without documentation; `site` is its first assignment in the document, if any. */
  | { readonly kind: 'global'; readonly name: string; readonly site: DeclarationSite | undefined; readonly link: ExternalEntry | undefined }
  | { readonly kind: 'library'; readonly entry: ManualEntry }
  | { readonly kind: 'engineReplaced'; readonly replacement: EngineReplacement; readonly entry: ManualEntry | undefined }
  | { readonly kind: 'external'; readonly entry: ExternalEntry };

export interface HoverHit {
  readonly target: HoverTarget;
  /** The name under the cursor. */
  readonly identifier: Ast.Identifier;
}

/** The first assignment to the global `name` in the document, if any. */
function firstWrite(document: ParsedDocument, name: string): Ast.Identifier | undefined {
  return definitions(document, { kind: 'global', name })[0];
}

/** A global that is not assigned in the document, looked up in what the server knows. */
function knownGlobal(name: string): HoverTarget | undefined {
  const replacement = engineReplacement(name);
  if (replacement) return { kind: 'engineReplaced', replacement, entry: manualEntry(name) };
  const entry = manualEntry(name);
  if (entry) return { kind: 'library', entry };
  const external = externalEntry(name);
  return external && { kind: 'external', entry: external };
}

function globalTarget(document: ParsedDocument, name: string): HoverTarget {
  const write = firstWrite(document, name);
  if (write) {
    return { kind: 'global', name, site: declarationSite(document, write), link: externalEntry(name) };
  }
  return knownGlobal(name) ?? { kind: 'global', name, site: undefined, link: undefined };
}

function variableTarget(document: ParsedDocument, { target, identifier, chunkIndex }: TargetHit): HoverTarget | undefined {
  if (target.kind === 'local') {
    const declaring = target.declaration.identifier;
    return { kind: 'local', declaration: target.declaration, site: declaring && declarationSite(document, declaring) };
  }
  // A field of a local `_ENV` table, or `_ENV` itself (the chunk's upvalue, not a global).
  const scopes = document.chunks[chunkIndex]?.scopes;
  if (!scopes || scopes.environmentFields.has(identifier) || identifier.name === '_ENV') {
    return undefined;
  }
  return globalTarget(document, target.name);
}

/** The manual's entry for the library member `dotted` (`string.format`), unless the document defines that member itself. */
function libraryMember(document: ParsedDocument, dotted: string): ManualEntry | undefined {
  return fieldWrites(document).has(dotted) ? undefined : manualEntry(dotted);
}

const isStringLiteral = (expression: Ast.Expression): boolean =>
  expression.kind === 'StringLiteral' || (expression.kind === 'ParenthesizedExpression' && isStringLiteral(expression.expression));

function memberTarget(document: ParsedDocument, { node, chunkIndex }: MemberOccurrence): HoverTarget | undefined {
  if (node.kind === 'MethodCallExpression') {
    // Strings have the string table as their metatable's __index (manual §6.4).
    if (isStringLiteral(node.base)) {
      const entry = libraryMember(document, `string.${node.method.name}`);
      return entry && { kind: 'library', entry };
    }
    const path = globalPath(document, chunkIndex, node.base);
    const entry = path?.length === 1 ? externalEntry(`${path.join('.')}:${node.method.name}`) : undefined;
    return entry && { kind: 'external', entry };
  }
  const path = globalPath(document, chunkIndex, node.base);
  if (!path) return undefined;
  const names = withoutG([...path, node.member.name]);
  const [head = ''] = names;
  if (names.length === 1) {
    return globalTarget(document, head);
  }
  const dotted = names.join('.');
  // Library members are documented one level deep (`string.format`); a module
  // table the document assigns itself is not the library's.
  const library = names.length === 2 && !firstWrite(document, head) ? libraryMember(document, dotted) : undefined;
  if (library) return { kind: 'library', entry: library };
  // EEex-Docs documents methods of game objects as `C:AddGold`; `C.AddGold` is the same function.
  const external = externalEntry(dotted) ?? (names.length === 2 ? externalEntry(names.join(':')) : undefined);
  return external && { kind: 'external', entry: external };
}

/** What to describe for the name at `offset`, or `undefined` when there is nothing to say. */
export function hoverTargetAt(document: ParsedDocument, offset: number): HoverHit | undefined {
  // A variable and a member name never touch (a `.` or `:` separates them),
  // so at most one of them is at `offset`.
  const member = memberAt(document, offset);
  if (member) {
    const target = memberTarget(document, member);
    return target && { target, identifier: member.identifier };
  }
  const variable = targetAt(document, offset);
  if (variable) {
    const target = variableTarget(document, variable);
    return target && { target, identifier: variable.identifier };
  }
  return undefined;
}
