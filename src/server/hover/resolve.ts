// What a hover describes: the name under the cursor and what it refers to.
// Pure: no LSP or `vscode` imports.
//
// - A local: its declaration (`local function f(a)`, a parameter, …), and its
//   LuaCATS doc comment or `@param` entry (docComments/attach.ts).
// - A global: shared by all chunks of a .menu file, as in navigation.ts.
//   1. Assigned in this document: described by its first assignment (and the
//      doc comment above it); the
//      document's own definition wins over the libraries (an EEex-Docs link is
//      still given, since a link makes no claim about behaviour).
//   2. Replaced by the engine (`print`): a note instead of the manual text.
//   3. In the libraries of the runtime (`Library`, knowledge.ts: the Lua 5.2
//      manual's basic functions and module tables string, table, math, bit32,
//      debug; with LuaJIT, all of them but bit32, plus bit and jit), then EEex-Docs.
//   4. Otherwise just a global, without documentation: also io, os, require
//      and coroutine, which the engine does not provide (LuaJIT does, but they
//      are not documented here, as plan.md scopes the help text).
// - A field or method name, by what its receiver provably is (receiver.ts):
//   - a global path, also through a local that aliases one (`local s = string`):
//     library and EEex-Docs names (`string.format`, `_G.string.format`,
//     `C:AddGold()`, `EEex_Options_Option.new`), then the functions the document
//     stores in that table;
//   - a string (`("x"):rep()`, `s:upper()` for a string local): the string
//     library, as a method (manual §6.4), also as `s.upper`;
//   - a LuaJIT object or module (`buf:put()`, `ffi.new` after
//     `local ffi = require("ffi")`): the LuaJIT documentation;
//   - a table the document defines functions in (`function Obj:m()`, `self:m()`
//     inside a method of `Obj`, a `---@type Obj` value of a `---@class Obj`): that
//     function, with its doc comment.
//   Anything else has no hover. As for globals, a library member the document
//   defines itself (`string.format = f`, `function string.trim()`) is not
//   described by the manual. The names of definitions (`m` in `function Obj:m()`)
//   are described like their uses.
//
// Names resolved through a local `_ENV` are fields of that table, so they get
// no hover. Without type inference that is the only safe answer.

import { docCommentFor, parameterDoc } from '../docComments/attach.ts';
import type { DocComment, DocParam } from '../docComments/parse.ts';
import type * as Ast from '../syntax/ast.ts';
import type { ParsedDocument } from '../syntax/document.ts';
import { fieldWrites, globalPath, withoutG } from '../syntax/globalPaths.ts';
import { memberAt, type MemberOccurrence } from '../syntax/members.ts';
import { targetAt, type TargetHit } from '../syntax/navigation.ts';
import type { Declaration } from '../syntax/scope.ts';
import { declarationSite, type DeclarationSite } from '../syntax/signatures.ts';
import { engineReplacement, externalEntry, LUA52, type EngineReplacement, type ExternalEntry, type Library, type ManualEntry } from './knowledge.ts';
import { definitionAt, memberOf, Types, type MemberDefinition, type TableRef } from './receiver.ts';

export type HoverTarget =
  /** `doc`: the doc comment of its declaration; `param`: the `@param` entry of a parameter (docComments/attach.ts). */
  | { readonly kind: 'local'; readonly declaration: Declaration; readonly site: DeclarationSite | undefined; readonly doc: DocComment | undefined; readonly param: DocParam | undefined }
  /**
   * A global without library documentation; `site` is its first assignment in
   * the document, if any, and `doc` the doc comment of that assignment.
   */
  | { readonly kind: 'global'; readonly name: string; readonly site: DeclarationSite | undefined; readonly doc: DocComment | undefined; readonly link: ExternalEntry | undefined }
  | { readonly kind: 'library'; readonly entry: ManualEntry }
  | { readonly kind: 'engineReplaced'; readonly replacement: EngineReplacement; readonly entry: ManualEntry | undefined }
  | { readonly kind: 'external'; readonly entry: ExternalEntry }
  /** A function the document stores in a table (`function Obj:m()`), see receiver.ts. */
  | { readonly kind: 'member'; readonly definition: MemberDefinition };

export interface HoverHit {
  readonly target: HoverTarget;
  /** The name under the cursor. */
  readonly identifier: Ast.Identifier;
}

/** The first assignment to each global of each document, by name; dropped with the document. */
const firstWriteIndexes = new WeakMap<ParsedDocument, ReadonlyMap<string, Ast.Identifier>>();

/**
 * The first assignment to the global `name` in the document, if any: the
 * first of `definitions` (syntax/navigation.ts), which is in document order. Indexed once per
 * document, as a .menu file has thousands of chunks to search.
 */
function firstWrite(document: ParsedDocument, name: string): Ast.Identifier | undefined {
  let index = firstWriteIndexes.get(document);
  if (!index) {
    const first = new Map<string, Ast.Identifier>();
    for (const { scopes } of document.chunks) {
      for (const identifier of scopes.writes) {
        const earlier = first.get(identifier.name);
        // Chunks are in document order and never overlap, so the lowest offset comes first.
        if (!scopes.resolved.has(identifier) && (!earlier || identifier.start < earlier.start)) first.set(identifier.name, identifier);
      }
    }
    index = first;
    firstWriteIndexes.set(document, index);
  }
  return index.get(name);
}

/** A global that is not assigned in the document, looked up in what the server knows. */
function knownGlobal(name: string, library: Library): HoverTarget | undefined {
  const replacement = engineReplacement(name);
  if (replacement) return { kind: 'engineReplaced', replacement, entry: library.global(name) };
  const entry = library.global(name);
  if (entry) return { kind: 'library', entry };
  const external = externalEntry(name);
  return external && { kind: 'external', entry: external };
}

function globalTarget(document: ParsedDocument, name: string, library: Library): HoverTarget {
  const write = firstWrite(document, name);
  if (write) {
    return { kind: 'global', name, site: declarationSite(document, write), doc: docCommentFor(document, write), link: externalEntry(name) };
  }
  return knownGlobal(name, library) ?? { kind: 'global', name, site: undefined, doc: undefined, link: undefined };
}

/** What to describe for a variable occurrence (see `targetAt`), or `undefined` when there is nothing to say. */
export function variableTarget(document: ParsedDocument, { target }: TargetHit, library: Library = LUA52): HoverTarget | undefined {
  if (target.kind === 'local') {
    const declaring = target.declaration.identifier;
    return {
      kind: 'local',
      declaration: target.declaration,
      site: declaring && declarationSite(document, declaring),
      doc: declaring && docCommentFor(document, declaring),
      param: declaring && target.declaration.kind === 'parameter' ? parameterDoc(document, declaring) : undefined,
    };
  }
  // `targetAt` never returns `_ENV` or a field of a local `_ENV` table.
  return globalTarget(document, target.name, library);
}

/** The manual's entry for the library member `dotted` (`string.format`), unless the document defines that member itself. */
function libraryMember(document: ParsedDocument, dotted: string, library: Library): ManualEntry | undefined {
  return fieldWrites(document).has(dotted) ? undefined : library.global(dotted);
}

/** What to describe for member `name` of the global path `path` (`string.format`, `C:AddGold`, `Obj:m`). */
function globalMemberTarget(document: ParsedDocument, path: readonly string[], name: string, method: boolean, library: Library): HoverTarget | undefined {
  if (method) {
    const names = withoutG([...path]);
    const external = names.length === 1 ? externalEntry(`${names.join('.')}:${name}`) : undefined;
    if (external) return { kind: 'external', entry: external };
    const own = memberOf(document, library, { root: 'global', path: names }, name);
    return own && { kind: 'member', definition: own };
  }
  const names = withoutG([...path, name]);
  const [head = ''] = names;
  if (names.length === 1) {
    return globalTarget(document, head, library);
  }
  const dotted = names.join('.');
  // Library members are documented one level deep (`string.format`); a module
  // table the document assigns itself is not the library's.
  const entry = names.length === 2 && !firstWrite(document, head) ? libraryMember(document, dotted, library) : undefined;
  if (entry) return { kind: 'library', entry };
  // EEex-Docs documents methods of game objects as `C:AddGold`; `C.AddGold` is the same function.
  const external = externalEntry(dotted) ?? (names.length === 2 ? externalEntry(names.join(':')) : undefined);
  if (external) return { kind: 'external', entry: external };
  const own = memberOf(document, library, { root: 'global', path: names.slice(0, -1) }, name);
  return own && { kind: 'member', definition: own };
}

/** What to describe for member `name` of a table the code names (see receiver.ts). */
function tableMemberTarget(document: ParsedDocument, table: TableRef, name: string, method: boolean, library: Library): HoverTarget | undefined {
  if (table.root === 'global') return globalMemberTarget(document, table.path, name, method, library);
  const own = memberOf(document, library, table, name);
  return own && { kind: 'member', definition: own };
}

/** What to describe for a field or method name (see `memberIndex`), or `undefined` when there is nothing to say. */
export function memberTarget(document: ParsedDocument, { node, chunkIndex }: MemberOccurrence, library: Library = LUA52): HoverTarget | undefined {
  const method = node.kind === 'MethodCallExpression';
  const name = method ? node.method.name : node.member.name;
  // A chain of globals as written (`_G.string.format`) keeps the rules of globals above.
  const path = globalPath(document, chunkIndex, node.base);
  if (path) return globalMemberTarget(document, path, name, method, library);
  const type = new Types(document, library).of(chunkIndex, node.base);
  switch (type?.kind) {
    case 'string': {
      // Strings have the string table as their metatable's __index (manual §6.4), so a
      // `string.x` the document defines is what `s:x()` calls.
      if (fieldWrites(document).has(`string.${name}`)) {
        const own = memberOf(document, library, { root: 'global', path: ['string'] }, name);
        return own && { kind: 'member', definition: own };
      }
      const entry = library.method('string', name);
      return entry && { kind: 'library', entry };
    }
    case 'object': {
      const entry = library.method(type.type, name);
      return entry && { kind: 'library', entry };
    }
    case 'module': {
      const entry = method ? undefined : library.requiredMember(type.module, name);
      return entry && { kind: 'library', entry };
    }
    case 'table':
      return tableMemberTarget(document, type.table, name, method, library);
    case undefined:
      return undefined;
  }
}

/** What to describe for the name at `offset`, or `undefined` when there is nothing to say. */
export function hoverTargetAt(document: ParsedDocument, offset: number, library: Library = LUA52): HoverHit | undefined {
  // A variable and a member name never touch (a `.` or `:` separates them),
  // so at most one of them is at `offset`.
  const member = memberAt(document, offset);
  if (member) {
    const target = memberTarget(document, member, library);
    return target && { target, identifier: member.identifier };
  }
  const definition = definitionAt(document, library, offset);
  if (definition) return { target: { kind: 'member', definition: definition.definition }, identifier: definition.identifier };
  const variable = targetAt(document, offset);
  if (variable) {
    const target = variableTarget(document, variable, library);
    return target && { target, identifier: variable.identifier };
  }
  return undefined;
}
