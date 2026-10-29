// Name resolution for a Lua 5.2 chunk, following the visibility rules of the
// manual (§3.5). Pure: no LSP or `vscode` imports.
//
// - `local x = x`: the new `x` is visible only after the statement.
// - `local function f`: `f` is visible inside its own body.
// - Parameters, and the implicit `self` of `function a:m()`, are visible in the
//   function body; `for` variables in the loop body.
// - `repeat … until cond`: `cond` sees the locals of the body.
// - Any other name is a global (a field of _ENV). While a local named `_ENV`
//   is visible, such a name is a field of that local table instead (§2.2); it
//   is still listed with the globals, and also in `environmentFields`.
//
// Each declaration also records where it is visible (`Declaration.visible`),
// for features that work at a position where no name is written yet
// (completion). A scope ends at its closing keyword (`end`, or the `until`
// condition); when the parser found none, at the end of the enclosing scope.

import type * as Ast from './ast.ts';

export type DeclarationKind = 'local' | 'localFunction' | 'parameter' | 'self' | 'forVariable';

/**
 * Where a declaration is visible: the offsets `o` with `start < o <= end`. The
 * start is exclusive, so a cursor at the end of `local x = y` (still typing
 * `y`) does not see the new `x`; the end is inclusive, so a cursor just before
 * the closing keyword still does.
 */
export interface Visibility {
  readonly start: number;
  readonly end: number;
}

export interface Declaration {
  readonly name: string;
  readonly kind: DeclarationKind;
  /** The declaring identifier; `undefined` for the implicit `self`. */
  readonly identifier: Ast.Identifier | undefined;
  /** Uses of the declaration, in source order (the declaring identifier excluded). */
  readonly references: Ast.Identifier[];
  readonly visible: Visibility;
}

export interface ScopeAnalysis {
  /** Every local declaration, in source order. */
  readonly declarations: readonly Declaration[];
  /** The declaration of each identifier that names a local, including declaring identifiers. Globals are absent. */
  readonly resolved: ReadonlyMap<Ast.Identifier, Declaration>;
  /** Identifiers that name globals, by name, in source order. */
  readonly globals: ReadonlyMap<string, readonly Ast.Identifier[]>;
  /**
   * Identifiers that are assigned a value without being declared: the targets of
   * `x = …` and the name of `function x()`. Local or global; declaring
   * identifiers are not included (see `declarations`).
   */
  readonly writes: ReadonlySet<Ast.Identifier>;
  /**
   * Global-looking identifiers resolved while a local, parameter or `for`
   * variable named `_ENV` was visible: fields of that table, not of the
   * global environment. Also listed in `globals`.
   */
  readonly environmentFields: ReadonlySet<Ast.Identifier>;
}

export function analyzeScopes(chunk: Ast.Chunk): ScopeAnalysis {
  const declarations: Declaration[] = [];
  const resolved = new Map<Ast.Identifier, Declaration>();
  const globals = new Map<string, Ast.Identifier[]>();
  const writes = new Set<Ast.Identifier>();
  const environmentFields = new Set<Ast.Identifier>();
  /** Open scopes, innermost last, each with the offset where it ends. */
  const scopes: { readonly names: Map<string, Declaration>; readonly end: number }[] = [];
  const scopeEnd = (): number => scopes.at(-1)?.end ?? chunk.end;

  /** Declares `name`, visible after offset `from` until the end of the current scope. */
  const declare = (kind: DeclarationKind, name: string, identifier: Ast.Identifier | undefined, from: number): void => {
    const declaration: Declaration = { name, kind, identifier, references: [], visible: { start: from, end: scopeEnd() } };
    declarations.push(declaration);
    if (identifier) resolved.set(identifier, declaration);
    scopes.at(-1)?.names.set(name, declaration);
  };

  const lookup = (name: string): Declaration | undefined => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const declaration = scopes[i]?.names.get(name);
      if (declaration) return declaration;
    }
    return undefined;
  };

  const use = (identifier: Ast.Identifier): void => {
    const declaration = lookup(identifier.name);
    if (declaration) {
      declaration.references.push(identifier);
      resolved.set(identifier, declaration);
      return;
    }
    // The chunk's own _ENV is an upvalue, never in `scopes`: only a local one is found.
    if (lookup('_ENV')) environmentFields.add(identifier);
    const uses = globals.get(identifier.name);
    if (uses) uses.push(identifier);
    else globals.set(identifier.name, [identifier]);
  };

  /** Runs `body` in a new scope that ends at `closeAt`, or with the enclosing scope when the closing keyword is missing. */
  const scoped = (closeAt: number | undefined, body: () => void): void => {
    scopes.push({ names: new Map(), end: closeAt ?? scopeEnd() });
    try {
      body();
    } finally {
      scopes.pop();
    }
  };

  const block = (node: Ast.Block): void => {
    for (const statement of node.body) visitStatement(statement);
  };

  const func = (node: Ast.FunctionExpression, isMethod: boolean): void => {
    scoped(node.closeStart, () => {
      if (isMethod) declare('self', 'self', undefined, node.start);
      for (const parameter of node.parameters) declare('parameter', parameter.name, parameter, parameter.end);
      block(node.body);
    });
  };

  const expressions = (nodes: readonly Ast.Expression[]): void => {
    for (const node of nodes) visitExpression(node);
  };

  function visitStatement(node: Ast.Statement): void {
    switch (node.kind) {
      case 'LocalStatement':
        expressions(node.values);
        for (const name of node.names) declare('local', name.name, name, node.end);
        break;
      case 'LocalFunctionStatement':
        declare('localFunction', node.name.name, node.name, node.name.end);
        func(node.func, false);
        break;
      case 'FunctionDeclaration': {
        // Only the first name is a variable; the rest are field names.
        const [first] = node.path;
        if (first) {
          use(first);
          // `function x()` assigns x; `function x.y()` and `function x:m()` only read it.
          if (node.path.length === 1 && node.method === undefined) writes.add(first);
        }
        func(node.func, node.method !== undefined);
        break;
      }
      case 'AssignmentStatement':
        // No declaration happens in between, so visiting in source order is exact.
        expressions(node.targets);
        expressions(node.values);
        for (const target of node.targets) {
          if (target.kind === 'Identifier') writes.add(target);
        }
        break;
      case 'CallStatement':
        visitExpression(node.call);
        break;
      case 'DoStatement':
        scoped(node.closeStart, () => {
          block(node.body);
        });
        break;
      case 'WhileStatement':
        visitExpression(node.condition);
        scoped(node.closeStart, () => {
          block(node.body);
        });
        break;
      case 'RepeatStatement':
        // The `until` condition is in the scope of the body.
        scoped(node.closeStart === undefined ? undefined : node.end, () => {
          block(node.body);
          if (node.condition) visitExpression(node.condition);
        });
        break;
      case 'IfStatement':
        node.clauses.forEach((clause, i) => {
          if (clause.condition) visitExpression(clause.condition);
          scoped(node.clauses[i + 1]?.start ?? node.closeStart, () => {
            block(clause.body);
          });
        });
        break;
      case 'NumericForStatement':
        visitExpression(node.initial);
        visitExpression(node.limit);
        if (node.step) visitExpression(node.step);
        scoped(node.closeStart, () => {
          declare('forVariable', node.variable.name, node.variable, (node.step ?? node.limit).end);
          block(node.body);
        });
        break;
      case 'GenericForStatement':
        expressions(node.iterators);
        scoped(node.closeStart, () => {
          const from = node.iterators.at(-1)?.end ?? node.variables.at(-1)?.end ?? node.start;
          for (const variable of node.variables) declare('forVariable', variable.name, variable, from);
          block(node.body);
        });
        break;
      case 'ReturnStatement':
        expressions(node.values);
        break;
      case 'BreakStatement':
      case 'GotoStatement':
      case 'LabelStatement':
        break;
    }
  }

  function visitExpression(node: Ast.Expression): void {
    switch (node.kind) {
      case 'Identifier':
        use(node);
        break;
      case 'FunctionExpression':
        func(node, false);
        break;
      case 'TableConstructor':
        for (const field of node.fields) {
          if (field.form === 'keyed' && field.key) visitExpression(field.key);
          visitExpression(field.value);
        }
        break;
      case 'BinaryExpression':
        visitExpression(node.left);
        visitExpression(node.right);
        break;
      case 'UnaryExpression':
        visitExpression(node.argument);
        break;
      case 'ParenthesizedExpression':
        visitExpression(node.expression);
        break;
      case 'MemberExpression':
        visitExpression(node.base);
        break;
      case 'IndexExpression':
        visitExpression(node.base);
        visitExpression(node.index);
        break;
      case 'CallExpression':
      case 'MethodCallExpression':
        visitExpression(node.base);
        expressions(node.arguments.values);
        break;
      case 'NilLiteral':
      case 'BooleanLiteral':
      case 'NumberLiteral':
      case 'StringLiteral':
      case 'VarargLiteral':
        break;
    }
  }

  scoped(chunk.end, () => {
    block(chunk.body);
  });
  return { declarations, resolved, globals, writes, environmentFields };
}

/**
 * The declarations visible at `offset`, one per name: the innermost, which
 * hides the others (the one that became visible last).
 */
export function visibleAt(scopes: ScopeAnalysis, offset: number): Declaration[] {
  const byName = new Map<string, Declaration>();
  for (const declaration of scopes.declarations) {
    const { start, end } = declaration.visible;
    if (start < offset && offset <= end && (byName.get(declaration.name)?.visible.start ?? -1) < start) {
      byName.set(declaration.name, declaration);
    }
  }
  return [...byName.values()];
}
