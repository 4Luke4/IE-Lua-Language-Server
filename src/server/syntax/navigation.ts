// Same-document navigation: the variable under the cursor, its definitions and
// its references. Pure: no LSP or `vscode` imports.
//
// Locals belong to one chunk. Globals are shared by every chunk of a document:
// the Lua of a .menu file runs in one global environment. Field names (`t.x`,
// `t:m()`, `{ x = 1 }`) are not variables and are never targets.

import type * as Ast from './ast.ts';
import type { ParsedDocument } from './document.ts';
import type { Declaration } from './scope.ts';

export type NavigationTarget =
  | {
      readonly kind: 'local';
      /** Index in `ParsedDocument.chunks` of the chunk that declares the local. */
      readonly chunkIndex: number;
      readonly declaration: Declaration;
    }
  | { readonly kind: 'global'; readonly name: string };

export interface TargetHit {
  readonly target: NavigationTarget;
  /** The identifier under the cursor. */
  readonly identifier: Ast.Identifier;
  /** Index in `ParsedDocument.chunks` of the chunk the identifier is in. */
  readonly chunkIndex: number;
}

export interface VariableOccurrence {
  readonly identifier: Ast.Identifier;
  /** Index in `ParsedDocument.chunks` of the chunk the identifier is in. */
  readonly chunkIndex: number;
}

/** Variable identifiers of each document, sorted by offset; dropped with the document. */
const indexes = new WeakMap<ParsedDocument, readonly VariableOccurrence[]>();

/** Every identifier that names a variable (local or global), sorted by offset. */
export function variableIndex(document: ParsedDocument): readonly VariableOccurrence[] {
  let index = indexes.get(document);
  if (!index) {
    const entries: VariableOccurrence[] = [];
    document.chunks.forEach(({ scopes }, chunkIndex) => {
      for (const identifier of scopes.resolved.keys()) entries.push({ identifier, chunkIndex });
      for (const uses of scopes.globals.values()) {
        for (const identifier of uses) entries.push({ identifier, chunkIndex });
      }
    });
    index = entries.sort((a, b) => a.identifier.start - b.identifier.start);
    indexes.set(document, index);
  }
  return index;
}

/**
 * The entry of `sorted` (sorted by identifier offset) whose identifier is at
 * `offset`. A cursor just after a name still selects it, as editors place the
 * cursor there after typing.
 */
export function identifierAt<T extends { readonly identifier: Ast.Identifier }>(sorted: readonly T[], offset: number): T | undefined {
  // Last identifier starting at or before `offset`. Identifiers never touch, so
  // one starting exactly at `offset` wins over one ending there.
  let low = 0;
  let high = sorted.length - 1;
  let found: T | undefined;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const entry = sorted[middle];
    if (entry && entry.identifier.start <= offset) {
      found = entry;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found && offset <= found.identifier.end ? found : undefined;
}

/**
 * The variable at `offset`, or `undefined` when there is none (keyword, field
 * name, string, comment, menu syntax). A cursor just after a name still
 * selects it, as editors place the cursor there after typing.
 */
export function targetAt(document: ParsedDocument, offset: number): TargetHit | undefined {
  const found = identifierAt(variableIndex(document), offset);
  if (!found) {
    return undefined;
  }
  const { identifier, chunkIndex } = found;
  const declaration = document.chunks[chunkIndex]?.scopes.resolved.get(identifier);
  return {
    identifier,
    chunkIndex,
    target: declaration ? { kind: 'local', chunkIndex, declaration } : { kind: 'global', name: identifier.name },
  };
}

/** Every identifier naming the global `name`, in document order, with whether it assigns the global. */
function globalUses(document: ParsedDocument, name: string): { identifier: Ast.Identifier; isWrite: boolean }[] {
  return document.chunks.flatMap(({ scopes }) => (scopes.globals.get(name) ?? []).map((identifier) => ({ identifier, isWrite: scopes.writes.has(identifier) })));
}

/**
 * Where the target is defined, in document order: the declaring identifier of
 * a local, or every assignment to a global in this document. Empty for the
 * implicit `self` and for globals this document never assigns (standard
 * library, game and EEex functions, globals of other files).
 */
export function definitions(document: ParsedDocument, target: NavigationTarget): Ast.Identifier[] {
  if (target.kind === 'local') {
    return target.declaration.identifier ? [target.declaration.identifier] : [];
  }
  return globalUses(document, target.name)
    .filter((use) => use.isWrite)
    .map((use) => use.identifier);
}

/**
 * Every identifier naming the target, in document order. Without
 * `includeDeclaration`, the definitions (see `definitions`) are left out.
 */
export function references(document: ParsedDocument, target: NavigationTarget, includeDeclaration: boolean): Ast.Identifier[] {
  if (target.kind === 'local') {
    const { identifier, references: uses } = target.declaration;
    const all = includeDeclaration && identifier ? [identifier, ...uses] : [...uses];
    return all.sort((a, b) => a.start - b.start);
  }
  return globalUses(document, target.name)
    .filter((use) => includeDeclaration || !use.isWrite)
    .map((use) => use.identifier);
}

// ------------------------------------------------------------- across files
//
// The Enhanced Editions run all their Lua in one global state, "shared by the
// MENU file, the game's own Lua files and the engine" (IESDP, Engine Lua
// globals: https://gibberlings3.github.io/iesdp/file_formats/ie_formats/lua_globals.htm),
// so a global of one file is the same variable in every other file. `_ENV` is
// not: each chunk has its own (manual §2.2), and a name resolved through a local
// `_ENV` is a field of that table, not a global.

/** One identifier naming a global, by offset in the document text. */
export interface GlobalOccurrence {
  readonly start: number;
  readonly end: number;
  /** Whether it assigns the global (`x = …`, `function x()`). */
  readonly isWrite: boolean;
}

/** Whether `identifier` (of the chunk `scopes` belongs to) names a variable shared with other files. */
function isSharedGlobal(scopes: ParsedDocument['chunks'][number]['scopes'], identifier: Ast.Identifier): boolean {
  return identifier.name !== '_ENV' && !scopes.resolved.has(identifier) && !scopes.environmentFields.has(identifier);
}

/**
 * The identifiers of the document that name globals shared with other files,
 * by name, each list in document order. `_ENV` and names resolved through a
 * local `_ENV` are left out.
 */
export function globalOccurrences(document: ParsedDocument): Map<string, GlobalOccurrence[]> {
  const result = new Map<string, GlobalOccurrence[]>();
  for (const { scopes } of document.chunks) {
    for (const [name, identifiers] of scopes.globals) {
      for (const identifier of identifiers) {
        if (!isSharedGlobal(scopes, identifier)) continue;
        let list = result.get(name);
        if (!list) {
          list = [];
          result.set(name, list);
        }
        list.push({ start: identifier.start, end: identifier.end, isWrite: scopes.writes.has(identifier) });
      }
    }
  }
  for (const list of result.values()) list.sort((a, b) => a.start - b.start);
  return result;
}

/**
 * The name of the global shared with other files that `hit` is on, or
 * `undefined` for locals, `_ENV` and names resolved through a local `_ENV`.
 */
export function sharedGlobalName(document: ParsedDocument, hit: TargetHit): string | undefined {
  const scopes = document.chunks[hit.chunkIndex]?.scopes;
  return hit.target.kind === 'global' && scopes && isSharedGlobal(scopes, hit.identifier) ? hit.target.name : undefined;
}
