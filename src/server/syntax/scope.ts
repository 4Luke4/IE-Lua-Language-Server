// Name resolution for a Lua 5.2 chunk, following the visibility rules of the
// manual (§3.5). Pure: no LSP or `vscode` imports.
//
// - `local x = x`: the new `x` is visible only after the statement.
// - `local function f`: `f` is visible inside its own body.
// - Parameters, and the implicit `self` of `function a:m()`, are visible in the
//   function body; `for` variables in the loop body.
// - `repeat … until cond`: `cond` sees the locals of the body.
// - Any other name is a global (a field of _ENV).

import type * as Ast from './ast.ts';

export type DeclarationKind = 'local' | 'localFunction' | 'parameter' | 'self' | 'forVariable';

export interface Declaration {
  readonly name: string;
  readonly kind: DeclarationKind;
  /** The declaring identifier; `undefined` for the implicit `self`. */
  readonly identifier: Ast.Identifier | undefined;
  /** Uses of the declaration, in source order (the declaring identifier excluded). */
  readonly references: Ast.Identifier[];
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
}

export function analyzeScopes(chunk: Ast.Chunk): ScopeAnalysis {
  const declarations: Declaration[] = [];
  const resolved = new Map<Ast.Identifier, Declaration>();
  const globals = new Map<string, Ast.Identifier[]>();
  const writes = new Set<Ast.Identifier>();
  const scopes: Map<string, Declaration>[] = [];

  const declare = (kind: DeclarationKind, name: string, identifier: Ast.Identifier | undefined): void => {
    const declaration: Declaration = { name, kind, identifier, references: [] };
    declarations.push(declaration);
    if (identifier) resolved.set(identifier, declaration);
    scopes.at(-1)?.set(name, declaration);
  };

  const use = (identifier: Ast.Identifier): void => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const declaration = scopes[i]?.get(identifier.name);
      if (declaration) {
        declaration.references.push(identifier);
        resolved.set(identifier, declaration);
        return;
      }
    }
    const uses = globals.get(identifier.name);
    if (uses) uses.push(identifier);
    else globals.set(identifier.name, [identifier]);
  };

  const scoped = (body: () => void): void => {
    scopes.push(new Map());
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
    scoped(() => {
      if (isMethod) declare('self', 'self', undefined);
      for (const parameter of node.parameters) declare('parameter', parameter.name, parameter);
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
        for (const name of node.names) declare('local', name.name, name);
        break;
      case 'LocalFunctionStatement':
        declare('localFunction', node.name.name, node.name);
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
        scoped(() => {
          block(node.body);
        });
        break;
      case 'WhileStatement':
        visitExpression(node.condition);
        scoped(() => {
          block(node.body);
        });
        break;
      case 'RepeatStatement':
        scoped(() => {
          block(node.body);
          if (node.condition) visitExpression(node.condition);
        });
        break;
      case 'IfStatement':
        for (const clause of node.clauses) {
          if (clause.condition) visitExpression(clause.condition);
          scoped(() => {
            block(clause.body);
          });
        }
        break;
      case 'NumericForStatement':
        visitExpression(node.initial);
        visitExpression(node.limit);
        if (node.step) visitExpression(node.step);
        scoped(() => {
          declare('forVariable', node.variable.name, node.variable);
          block(node.body);
        });
        break;
      case 'GenericForStatement':
        expressions(node.iterators);
        scoped(() => {
          for (const variable of node.variables) declare('forVariable', variable.name, variable);
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

  scoped(() => {
    block(chunk.body);
  });
  return { declarations, resolved, globals, writes };
}
