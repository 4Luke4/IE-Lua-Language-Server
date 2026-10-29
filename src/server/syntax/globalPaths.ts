// `.` chains on globals (`string.format`, `_G.string.format`) and the fields a
// document assigns on global tables, shared by hover and completion. Pure: no
// LSP or `vscode` imports.
//
// Names resolved through a local `_ENV` are fields of that table, not globals,
// so a chain that starts with one is not a global path.

import type * as Ast from './ast.ts';
import type { ParsedDocument } from './document.ts';
import { walk } from './walk.ts';

/**
 * The names of a `.` chain on a global: `string` for `string`, `[_G, string]`
 * for `_G.string`; `undefined` when the chain starts with anything else (a
 * local, a call, an index, a field of a local `_ENV`).
 */
export function globalPath(document: ParsedDocument, chunkIndex: number, expression: Ast.Expression): string[] | undefined {
  if (expression.kind === 'MemberExpression') {
    const base = globalPath(document, chunkIndex, expression.base);
    return base && [...base, expression.member.name];
  }
  if (expression.kind !== 'Identifier') return undefined;
  const scopes = document.chunks[chunkIndex]?.scopes;
  if (!scopes || scopes.resolved.has(expression) || scopes.environmentFields.has(expression)) return undefined;
  return [expression.name];
}

/** `[a, b]` for `_G.a.b`: the `_G.` prefix removed while another name follows (manual §6.1, `_G`). */
export function withoutG(names: readonly string[]): string[] {
  const rest = [...names];
  while (rest.length > 1 && rest[0] === '_G') rest.shift();
  return rest;
}

/** Fields of global tables each document assigns, as `table.field`; dropped with the document. */
const fieldWriteIndexes = new WeakMap<ParsedDocument, ReadonlySet<string>>();

/**
 * The `table.field` names the document assigns on a global table:
 * `t.f = …` (`_G.t.f = …` too), `function t.f()` and `function t:f()`.
 */
export function fieldWrites(document: ParsedDocument): ReadonlySet<string> {
  let writes = fieldWriteIndexes.get(document);
  if (!writes) {
    const found = new Set<string>();
    document.chunks.forEach(({ tree, scopes }, chunkIndex) => {
      const isGlobal = (identifier: Ast.Identifier): boolean => !scopes.resolved.has(identifier) && !scopes.environmentFields.has(identifier);
      walk(tree.body, (node) => {
        if (node.kind === 'AssignmentStatement') {
          for (const target of node.targets) {
            const path = target.kind === 'MemberExpression' ? globalPath(document, chunkIndex, target) : undefined;
            const names = path && withoutG(path);
            if (names?.length === 2) found.add(names.join('.'));
          }
        } else if (node.kind === 'FunctionDeclaration') {
          const [head, field] = node.path;
          if (head && isGlobal(head)) {
            if (node.path.length === 2 && field && node.method === undefined) found.add(`${head.name}.${field.name}`);
            if (node.path.length === 1 && node.method) found.add(`${head.name}.${node.method.name}`);
          }
        }
      });
    });
    writes = found;
    fieldWriteIndexes.set(document, writes);
  }
  return writes;
}
