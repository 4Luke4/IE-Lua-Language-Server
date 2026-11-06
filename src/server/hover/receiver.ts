// What a receiver provably is, for describing `x:m()` and `x.f` (hover, completion,
// semantic tokens). Pure: no LSP or `vscode` imports.
//
// There is no type inference in general: a value has a type here only when the code
// or its LuaCATS annotations prove it, and anything else has none (so no hover
// rather than a guess). A value is:
//
// - a string: a string literal, or a local that is never assigned again and was
//   declared from one, or annotated `---@type string` / `---@param x string`. Strings
//   have the string library as their metatable's `__index` (Lua 5.2 manual §6.4;
//   LuaJIT's lib_string.c does the same), so `s:upper()` is `string.upper`;
// - a LuaJIT object (`string.buffer`): what a documented function returns (`returns`
//   in data/luajit/manual.json: `buffer.new()`, `buf:put()`);
// - a module `require` returns: `require("ffi")` with a string literal, when `require`
//   is the global the document never assigns and the library documents the module;
// - a table: a global path (`Obj`, `Obj.sub`, `worldScreen`), or a local the code
//   declares from a table constructor (`local M = {}`) and fields of it; also what a
//   `---@class Name` declares, for values annotated `---@type Name` or `---@param x
//   Name`; and the implicit `self` of `function T:m()`, which is `T` (LuaCATS reads it
//   the same way).
//
// A local follows its declared value only while nothing assigns it again (it could
// hold anything after `x = …`). An annotation states the type, so it holds anyway.

import { classDeclaration, docCommentFor, functionDoc, parameterDoc } from '../docComments/attach.ts';
import type { DocComment } from '../docComments/parse.ts';
import type * as Ast from '../syntax/ast.ts';
import type { ParsedDocument } from '../syntax/document.ts';
import type { Declaration } from '../syntax/scope.ts';
import { declarationSite } from '../syntax/signatures.ts';
import { walk } from '../syntax/walk.ts';
import type { Library } from './knowledge.ts';

/** A table the code names: a global path, or a local table and fields of it. */
export type TableRef =
  | { readonly root: 'global'; readonly path: readonly string[] }
  | { readonly root: 'local'; readonly declaration: Declaration; readonly fields: readonly string[] };

export type ValueType =
  | { readonly kind: 'string' }
  /** An object of a documented library type (`string.buffer`). */
  | { readonly kind: 'object'; readonly type: string }
  /** The table `require(module)` returns (`ffi`, `string.buffer`). */
  | { readonly kind: 'module'; readonly module: string }
  | { readonly kind: 'table'; readonly table: TableRef };

/** A function the document stores in a table: `function T:m()`, `function T.f()`, `T.f = function`, `{ f = function }`. */
export interface MemberDefinition {
  /** The table as written where it is defined: `Obj`, `M.sub`. */
  readonly owner: string;
  readonly name: string;
  /** Defined with `:` (an implicit `self` parameter). */
  readonly method: boolean;
  readonly func: Ast.FunctionExpression;
  readonly doc: DocComment | undefined;
  /** The name where it is defined. */
  readonly identifier: Ast.Identifier;
}

/** A small number of steps for alias chains (`local a = b`); cycles are also cut by `seen`. */
const MAX_DEPTH = 16;

/** The text of a short string literal without escapes, or of a long string; `undefined` otherwise. */
export function literalText(raw: string): string | undefined {
  const quoted = /^"([^"\\\n\r]*)"$|^'([^'\\\n\r]*)'$/.exec(raw);
  if (quoted) return quoted[1] ?? quoted[2];
  const long = /^\[(=*)\[([\s\S]*)\]\1\]$/.exec(raw);
  // A long string skips a first line break (manual §3.1).
  return long ? (long[2] ?? '').replace(/^\r\n|^\n\r|^\n|^\r/, '') : undefined;
}

const unwrap = (expression: Ast.Expression): Ast.Expression => (expression.kind === 'ParenthesizedExpression' ? unwrap(expression.expression) : expression);

/** The chunk that contains `offset`. */
function chunkAt(document: ParsedDocument, offset: number): number {
  return document.chunks.findIndex(({ tree }) => tree.start <= offset && offset <= tree.end);
}

/** Whether the document assigns the global `name` anywhere (`require = …`, `function require()`). */
function assignsGlobal(document: ParsedDocument, name: string): boolean {
  return document.chunks.some(({ scopes }) => [...scopes.writes].some((identifier) => identifier.name === name && !scopes.resolved.has(identifier)));
}

/** Whether nothing assigns the local again after its declaration. */
function constant(document: ParsedDocument, chunkIndex: number, declaration: Declaration): boolean {
  const writes = document.chunks[chunkIndex]?.scopes.writes;
  return writes !== undefined && !declaration.references.some((reference) => writes.has(reference));
}

/** Per document: the function declaration whose function starts at an offset, for the implicit `self`. */
const methodOwners = new WeakMap<ParsedDocument, ReadonlyMap<number, { declaration: Ast.FunctionDeclaration; chunkIndex: number }>>();

function methodOwner(document: ParsedDocument, functionStart: number): { declaration: Ast.FunctionDeclaration; chunkIndex: number } | undefined {
  let index = methodOwners.get(document);
  if (!index) {
    const found = new Map<number, { declaration: Ast.FunctionDeclaration; chunkIndex: number }>();
    document.chunks.forEach(({ tree }, chunkIndex) => {
      walk(tree.body, (node) => {
        if (node.kind === 'FunctionDeclaration' && node.method) found.set(node.func.start, { declaration: node, chunkIndex });
      });
    });
    index = found;
    methodOwners.set(document, index);
  }
  return index.get(functionStart);
}

/** Resolves value types in one document with one library. */
export class Types {
  private readonly document: ParsedDocument;
  private readonly library: Library;

  constructor(document: ParsedDocument, library: Library) {
    this.document = document;
    this.library = library;
  }

  /** The provable type of `expression` in chunk `chunkIndex`, if any. */
  of(chunkIndex: number, expression: Ast.Expression, depth = 0, seen: ReadonlySet<Declaration> = new Set()): ValueType | undefined {
    if (depth > MAX_DEPTH) return undefined;
    const node = unwrap(expression);
    switch (node.kind) {
      case 'StringLiteral':
        return { kind: 'string' };
      case 'Identifier': {
        const scopes = this.document.chunks[chunkIndex]?.scopes;
        if (!scopes || scopes.environmentFields.has(node)) return undefined;
        const declaration = scopes.resolved.get(node);
        if (!declaration) return { kind: 'table', table: { root: 'global', path: [node.name] } };
        return this.ofDeclaration(chunkIndex, declaration, depth + 1, seen);
      }
      case 'MemberExpression': {
        const base = this.of(chunkIndex, node.base, depth + 1, seen);
        if (base?.kind !== 'table') return undefined;
        const { table } = base;
        return {
          kind: 'table',
          table: table.root === 'global' ? { root: 'global', path: [...table.path, node.member.name] } : { ...table, fields: [...table.fields, node.member.name] },
        };
      }
      case 'CallExpression': {
        const callee = unwrap(node.base);
        if (callee.kind === 'Identifier' && callee.name === 'require') {
          const scopes = this.document.chunks[chunkIndex]?.scopes;
          const global = scopes !== undefined && !scopes.resolved.has(callee) && !scopes.environmentFields.has(callee);
          const [argument] = node.arguments.values;
          const name = argument?.kind === 'StringLiteral' && node.arguments.values.length === 1 ? literalText(argument.raw) : undefined;
          if (!global || name === undefined || assignsGlobal(this.document, 'require')) return undefined;
          return this.library.required(name)?.kind === 'module' ? { kind: 'module', module: name } : undefined;
        }
        if (callee.kind !== 'MemberExpression') return undefined;
        const base = this.of(chunkIndex, callee.base, depth + 1, seen);
        const entry = base?.kind === 'module' ? this.library.requiredMember(base.module, callee.member.name) : undefined;
        return entry?.returns === undefined ? undefined : { kind: 'object', type: entry.returns };
      }
      case 'MethodCallExpression': {
        const base = this.of(chunkIndex, node.base, depth + 1, seen);
        const entry = base?.kind === 'object' ? this.library.method(base.type, node.method.name) : undefined;
        return entry?.returns === undefined ? undefined : { kind: 'object', type: entry.returns };
      }
      default:
        return undefined;
    }
  }

  /** The provable type of a local, parameter or `self`. */
  ofDeclaration(chunkIndex: number, declaration: Declaration, depth = 0, seen: ReadonlySet<Declaration> = new Set()): ValueType | undefined {
    if (seen.has(declaration) || depth > MAX_DEPTH) return undefined;
    const next = new Set([...seen, declaration]);
    const { identifier } = declaration;
    if (declaration.kind === 'self') {
      const owner = methodOwner(this.document, declaration.visible.start);
      if (!owner) return undefined;
      const [root, ...fields] = owner.declaration.path;
      const base = root && this.of(owner.chunkIndex, root, depth + 1, next);
      if (base?.kind !== 'table') return undefined;
      const { table } = base;
      return { kind: 'table', table: table.root === 'global' ? { root: 'global', path: [...table.path, ...fields.map((f) => f.name)] } : { ...table, fields: [...table.fields, ...fields.map((f) => f.name)] } };
    }
    if (!identifier) return undefined;
    // An annotation states the type.
    const annotated =
      declaration.kind === 'parameter'
        ? parameterDoc(this.document, identifier)?.type
        : docCommentFor(this.document, identifier)?.tags.find((tag) => tag.tag === 'type')?.type;
    if (annotated !== undefined) return this.named(annotated.trim(), next);
    if (declaration.kind !== 'local' || !constant(this.document, chunkIndex, declaration)) return undefined;
    const site = declarationSite(this.document, identifier);
    const value = site?.kind === 'local' ? site.value : undefined;
    if (!value) return undefined;
    if (unwrap(value).kind === 'TableConstructor') return { kind: 'table', table: { root: 'local', declaration, fields: [] } };
    return this.of(chunkIndex, value, depth + 1, next);
  }

  /** The type a LuaCATS annotation names: `string`, or a `---@class` of the document. */
  named(name: string, seen: ReadonlySet<Declaration>): ValueType | undefined {
    if (name === 'string') return { kind: 'string' };
    const declared = classDeclaration(this.document, name);
    if (!declared) return undefined;
    const chunkIndex = chunkAt(this.document, declared.start);
    const declaration = this.document.chunks[chunkIndex]?.scopes.resolved.get(declared);
    if (!declaration) return { kind: 'table', table: { root: 'global', path: [declared.name] } };
    // `---@class M` above `local M = {}` names that local table, whatever M holds later.
    return declaration.kind === 'local' && !seen.has(declaration) ? { kind: 'table', table: { root: 'local', declaration, fields: [] } } : undefined;
  }
}

// ------------------------------------------------------------ members

/** Identity of a table across the document: equal for the same global path or the same local and fields. */
const declarationIds = new WeakMap<Declaration, number>();
let nextDeclarationId = 0;

export function tableKey(table: TableRef): string {
  if (table.root === 'global') return `g:${withoutGPath(table.path).join('.')}`;
  let id = declarationIds.get(table.declaration);
  if (id === undefined) {
    id = nextDeclarationId++;
    declarationIds.set(table.declaration, id);
  }
  return `l:${String(id)}:${table.fields.join('.')}`;
}

/** `a.b` for `_G.a.b` (manual §6.1, `_G`), while another name follows. */
function withoutGPath(path: readonly string[]): string[] {
  const rest = [...path];
  while (rest.length > 1 && rest[0] === '_G') rest.shift();
  return rest;
}

export interface DocumentMembers {
  /** The functions each table holds, by table key and name (the first definition of a name). */
  readonly byTable: ReadonlyMap<string, ReadonlyMap<string, MemberDefinition>>;
  /** Every defining name, sorted by offset, for hovering a definition. */
  readonly definitions: readonly { readonly identifier: Ast.Identifier; readonly definition: MemberDefinition }[];
}

const memberIndexes = new WeakMap<ParsedDocument, WeakMap<Library, DocumentMembers>>();

/** The functions the document stores in tables (see `MemberDefinition`), computed once per document and library. */
export function documentMembers(document: ParsedDocument, library: Library): DocumentMembers {
  let byLibrary = memberIndexes.get(document);
  if (!byLibrary) {
    byLibrary = new WeakMap();
    memberIndexes.set(document, byLibrary);
  }
  let members = byLibrary.get(library);
  if (!members) {
    members = collectMembers(document, library);
    byLibrary.set(library, members);
  }
  return members;
}

const ownerName = (table: TableRef): string => (table.root === 'global' ? withoutGPath(table.path).join('.') : [table.declaration.name, ...table.fields].join('.'));

function collectMembers(document: ParsedDocument, library: Library): DocumentMembers {
  const types = new Types(document, library);
  const byTable = new Map<string, Map<string, MemberDefinition>>();
  const definitions: { identifier: Ast.Identifier; definition: MemberDefinition }[] = [];
  const add = (table: TableRef | undefined, identifier: Ast.Identifier, func: Ast.FunctionExpression, method: boolean): void => {
    if (!table) return;
    const key = tableKey(table);
    let members = byTable.get(key);
    if (!members) {
      members = new Map();
      byTable.set(key, members);
    }
    const definition: MemberDefinition = { owner: ownerName(table), name: identifier.name, method, func, doc: functionDoc(document, func), identifier };
    if (!members.has(identifier.name)) members.set(identifier.name, definition);
    definitions.push({ identifier, definition });
  };
  const tableOf = (chunkIndex: number, expression: Ast.Expression): TableRef | undefined => {
    const type = types.of(chunkIndex, expression);
    return type?.kind === 'table' ? type.table : undefined;
  };
  document.chunks.forEach(({ tree }, chunkIndex) => {
    walk(tree.body, (node) => {
      switch (node.kind) {
        case 'FunctionDeclaration': {
          const [root, ...fields] = node.path;
          if (!root || (fields.length === 0 && !node.method)) break;
          const base = tableOf(chunkIndex, root);
          const owners = node.method ? fields : fields.slice(0, -1);
          const name = node.method ?? fields.at(-1);
          const table =
            base &&
            (base.root === 'global' ? { root: 'global' as const, path: [...base.path, ...owners.map((f) => f.name)] } : { ...base, fields: [...base.fields, ...owners.map((f) => f.name)] });
          if (name) add(table, name, node.func, node.method !== undefined);
          break;
        }
        case 'AssignmentStatement':
          node.targets.forEach((target, i) => {
            const value = node.values[i];
            if (target.kind === 'MemberExpression' && value?.kind === 'FunctionExpression') add(tableOf(chunkIndex, target.base), target.member, value, false);
          });
          break;
        case 'LocalStatement':
          node.names.forEach((name, i) => {
            const value = node.values[i];
            const declaration = document.chunks[chunkIndex]?.scopes.resolved.get(name);
            if (value?.kind !== 'TableConstructor' || !declaration) return;
            for (const field of value.fields) {
              if (field.form === 'named' && field.key?.kind === 'Identifier' && field.value.kind === 'FunctionExpression') {
                add({ root: 'local', declaration, fields: [] }, field.key, field.value, false);
              }
            }
          });
          break;
        default:
          break;
      }
    });
  });
  definitions.sort((a, b) => a.identifier.start - b.identifier.start);
  return { byTable, definitions };
}

/** The function the document stores under `name` in `table`, if any. */
export function memberOf(document: ParsedDocument, library: Library, table: TableRef, name: string): MemberDefinition | undefined {
  return documentMembers(document, library).byTable.get(tableKey(table))?.get(name);
}

/** Every function the document stores in `table`. */
export function membersOf(document: ParsedDocument, library: Library, table: TableRef): readonly MemberDefinition[] {
  return [...(documentMembers(document, library).byTable.get(tableKey(table))?.values() ?? [])];
}

/** The definition whose name is at `offset` (`m` in `function Obj:m()`); a cursor just after the name still selects it. */
export function definitionAt(document: ParsedDocument, library: Library, offset: number): { identifier: Ast.Identifier; definition: MemberDefinition } | undefined {
  const { definitions } = documentMembers(document, library);
  let found: { identifier: Ast.Identifier; definition: MemberDefinition } | undefined;
  for (const entry of definitions) {
    if (entry.identifier.start > offset) break;
    if (offset <= entry.identifier.end) found = entry;
  }
  return found;
}
