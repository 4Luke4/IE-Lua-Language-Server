// Generic traversal of a Lua syntax tree. Pure: no LSP or `vscode` imports.
import type * as Ast from './ast.ts';

export type WalkedNode = Ast.Statement | Ast.Expression;

/**
 * Calls `visit` for every statement and expression in `block`, in source
 * order, parents before children, including function bodies and table
 * fields. Identifiers that are not expressions (declared names, parameters,
 * field and method names, labels) are not visited.
 */
export function walk(block: Ast.Block, visit: (node: WalkedNode) => void): void {
  const statements = (nodes: readonly Ast.Statement[]): void => {
    for (const node of nodes) statement(node);
  };
  const expressions = (nodes: readonly Ast.Expression[]): void => {
    for (const node of nodes) expression(node);
  };

  function statement(node: Ast.Statement): void {
    visit(node);
    switch (node.kind) {
      case 'LocalStatement':
        expressions(node.values);
        break;
      case 'AssignmentStatement':
        expressions(node.targets);
        expressions(node.values);
        break;
      case 'CallStatement':
        expression(node.call);
        break;
      case 'DoStatement':
        statements(node.body.body);
        break;
      case 'WhileStatement':
        expression(node.condition);
        statements(node.body.body);
        break;
      case 'RepeatStatement':
        statements(node.body.body);
        if (node.condition) expression(node.condition);
        break;
      case 'IfStatement':
        for (const clause of node.clauses) {
          if (clause.condition) expression(clause.condition);
          statements(clause.body.body);
        }
        break;
      case 'NumericForStatement':
        expression(node.initial);
        expression(node.limit);
        if (node.step) expression(node.step);
        statements(node.body.body);
        break;
      case 'GenericForStatement':
        expressions(node.iterators);
        statements(node.body.body);
        break;
      case 'FunctionDeclaration':
      case 'LocalFunctionStatement':
        expression(node.func);
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

  function expression(node: Ast.Expression): void {
    visit(node);
    switch (node.kind) {
      case 'FunctionExpression':
        statements(node.body.body);
        break;
      case 'TableConstructor':
        for (const field of node.fields) {
          if (field.form === 'keyed' && field.key) expression(field.key);
          expression(field.value);
        }
        break;
      case 'BinaryExpression':
        expression(node.left);
        expression(node.right);
        break;
      case 'UnaryExpression':
        expression(node.argument);
        break;
      case 'ParenthesizedExpression':
        expression(node.expression);
        break;
      case 'MemberExpression':
        expression(node.base);
        break;
      case 'IndexExpression':
        expression(node.base);
        expression(node.index);
        break;
      case 'CallExpression':
      case 'MethodCallExpression':
        expression(node.base);
        expressions(node.arguments.values);
        break;
      case 'Identifier':
      case 'NilLiteral':
      case 'BooleanLiteral':
      case 'NumberLiteral':
      case 'StringLiteral':
      case 'VarargLiteral':
        break;
    }
  }

  statements(block.body);
}
