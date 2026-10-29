// How a variable gets its value where it is declared or assigned, for
// describing it (hover). Pure: no LSP or `vscode` imports.

import type * as Ast from './ast.ts';
import type { ParsedDocument } from './document.ts';
import { walk } from './walk.ts';

/** The statement that declares or assigns a name. */
export type DeclarationSite =
  /** `local function f(…)`. */
  | { readonly kind: 'localFunction'; readonly func: Ast.FunctionExpression }
  /** `local x, y = …`; `value` is the expression in the same position, if any. */
  | { readonly kind: 'local'; readonly value: Ast.Expression | undefined }
  /** `function x(…)` (one name, no fields or method). */
  | { readonly kind: 'functionDeclaration'; readonly func: Ast.FunctionExpression }
  /** `x, y = …`; `value` is the expression in the same position, if any. */
  | { readonly kind: 'assignment'; readonly value: Ast.Expression | undefined };

/** `(a, b, ...)`: the parameter list of a function as written. */
export function parameterList(func: Ast.FunctionExpression): string {
  const names = func.parameters.map((parameter) => parameter.name);
  if (func.isVararg) names.push('...');
  return `(${names.join(', ')})`;
}

/** Declaration sites of each document, by declaring or assigned identifier; dropped with the document. */
const indexes = new WeakMap<ParsedDocument, ReadonlyMap<Ast.Identifier, DeclarationSite>>();

function siteIndex(document: ParsedDocument): ReadonlyMap<Ast.Identifier, DeclarationSite> {
  let index = indexes.get(document);
  if (!index) {
    const sites = new Map<Ast.Identifier, DeclarationSite>();
    for (const { tree } of document.chunks) {
      walk(tree.body, (node) => {
        switch (node.kind) {
          case 'LocalFunctionStatement':
            sites.set(node.name, { kind: 'localFunction', func: node.func });
            break;
          case 'LocalStatement':
            node.names.forEach((name, i) => sites.set(name, { kind: 'local', value: node.values[i] }));
            break;
          case 'FunctionDeclaration': {
            const [name] = node.path;
            if (name && node.path.length === 1 && node.method === undefined) sites.set(name, { kind: 'functionDeclaration', func: node.func });
            break;
          }
          case 'AssignmentStatement':
            node.targets.forEach((target, i) => {
              if (target.kind === 'Identifier') sites.set(target, { kind: 'assignment', value: node.values[i] });
            });
            break;
          default:
            break;
        }
      });
    }
    index = sites;
    indexes.set(document, index);
  }
  return index;
}

/**
 * The statement in which `identifier` is declared (`local x`, `local function
 * f`) or assigned (`x = …`, `function x()`); `undefined` for any other
 * identifier (parameters, `for` variables, reads).
 */
export function declarationSite(document: ParsedDocument, identifier: Ast.Identifier): DeclarationSite | undefined {
  return siteIndex(document).get(identifier);
}
