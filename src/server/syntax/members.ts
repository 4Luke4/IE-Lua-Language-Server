// Field and method names used in expressions (`base.name`, `base:name(…)`),
// found by position. Pure: no LSP or `vscode` imports.
//
// Names in `function a.b:c()` declarations and keys of table constructors are
// not included: they define fields rather than use them.

import type * as Ast from './ast.ts';
import type { ParsedDocument } from './document.ts';
import { identifierAt } from './navigation.ts';
import { walk } from './walk.ts';

export interface MemberOccurrence {
  /** The field or method name. */
  readonly identifier: Ast.Identifier;
  /** The expression the name belongs to. */
  readonly node: Ast.MemberExpression | Ast.MethodCallExpression;
  /** Index in `ParsedDocument.chunks` of the chunk the name is in. */
  readonly chunkIndex: number;
}

/** Member names of each document, sorted by offset; dropped with the document. */
const indexes = new WeakMap<ParsedDocument, readonly MemberOccurrence[]>();

/** Every field and method name used in an expression, sorted by offset. */
export function memberIndex(document: ParsedDocument): readonly MemberOccurrence[] {
  let index = indexes.get(document);
  if (!index) {
    const entries: MemberOccurrence[] = [];
    document.chunks.forEach(({ tree }, chunkIndex) => {
      walk(tree.body, (node) => {
        if (node.kind === 'MemberExpression') entries.push({ identifier: node.member, node, chunkIndex });
        else if (node.kind === 'MethodCallExpression') entries.push({ identifier: node.method, node, chunkIndex });
      });
    });
    index = entries.sort((a, b) => a.identifier.start - b.identifier.start);
    indexes.set(document, index);
  }
  return index;
}

/** The field or method name at `offset`; a cursor just after the name still selects it. */
export function memberAt(document: ParsedDocument, offset: number): MemberOccurrence | undefined {
  return identifierAt(memberIndex(document), offset);
}
