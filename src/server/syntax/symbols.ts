// Outline of a document (LSP `textDocument/documentSymbol`). Pure: no LSP or
// `vscode` imports; src/server/features/documentSymbols.ts converts the result.
//
// Lua:
// - functions: `function a.b:m()`, `local function f`, and `x = function` /
//   `local x = function` / `t.f = function`, at any depth, nested under the
//   function that contains them;
// - variables: locals declared by top-level statements of a chunk, and the
//   first assignment to each global outside any function. Their table
//   constructors list named fields as children.
// Assignments to existing locals and locals inside functions or blocks are not
// listed, so that the outline shows what a file defines rather than every name.
//
// .menu files: each `menu { … }` block is a namespace named by its `name`
// property, holding the Lua symbols of the chunks inside it. `"…"` scripts
// (`action`, `onOpen`, …) contribute functions only; their assignments are
// runtime state, not definitions.

import type * as Ast from './ast.ts';
import type { ParsedChunk, ParsedDocument } from './document.ts';
import type { ScopeAnalysis } from './scope.ts';
import { parameterList } from './signatures.ts';

export type OutlineKind = 'function' | 'method' | 'variable' | 'field' | 'namespace';

export interface OutlineSymbol {
  /** Never empty (LSP clients reject empty names). */
  readonly name: string;
  readonly kind: OutlineKind;
  /** Parameter list of functions, e.g. `(a, b, ...)`. */
  readonly detail: string | undefined;
  /** The whole construct, `[start, end)` document offsets. */
  readonly start: number;
  readonly end: number;
  /** The name, inside `[start, end)`. */
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly children: OutlineSymbol[];
}

interface Context {
  readonly container: OutlineSymbol[];
  readonly scopes: ScopeAnalysis;
  /** Directly in the chunk's top-level block: locals are listed. */
  readonly topLevel: boolean;
  /** Outside every function body (and not in a menu script): global assignments are listed. */
  readonly listGlobals: boolean;
  /** Globals already listed in this document. */
  readonly seenGlobals: Set<string>;
}

const nested = (context: Context, container: OutlineSymbol[]): Context => ({ ...context, container, topLevel: false });
const inFunction = (context: Context, container: OutlineSymbol[]): Context => ({ ...nested(context, container), listGlobals: false });

/** `a`, `a.b.c` for identifiers and `.` chains on an identifier; `undefined` otherwise. */
function dottedName(expression: Ast.Expression): string | undefined {
  if (expression.kind === 'Identifier') return expression.name;
  if (expression.kind === 'MemberExpression') {
    const base = dottedName(expression.base);
    return base === undefined ? undefined : `${base}.${expression.member.name}`;
  }
  return undefined;
}

function functionSymbol(
  name: string,
  kind: 'function' | 'method',
  range: { start: number; end: number },
  selection: { start: number; end: number },
  func: Ast.FunctionExpression,
  context: Context,
): OutlineSymbol {
  const symbol: OutlineSymbol = {
    name, kind, detail: parameterList(func), start: range.start, end: range.end,
    selectionStart: selection.start, selectionEnd: selection.end, children: [],
  };
  block(func.body, inFunction(context, symbol.children));
  return symbol;
}

/** A variable or field; named fields of a table constructor value become children. */
function valueSymbol(
  name: string,
  kind: 'variable' | 'field',
  range: { start: number; end: number },
  selection: { start: number; end: number },
  value: Ast.Expression | undefined,
  context: Context,
): OutlineSymbol {
  const symbol: OutlineSymbol = {
    name, kind, detail: undefined, start: range.start, end: range.end,
    selectionStart: selection.start, selectionEnd: selection.end, children: [],
  };
  if (value?.kind === 'TableConstructor') {
    tableFields(value, nested(context, symbol.children));
  } else if (value) {
    expression(value, nested(context, symbol.children));
  }
  return symbol;
}

function tableFields(table: Ast.TableConstructor, context: Context): void {
  for (const field of table.fields) {
    if (field.form === 'named' && field.key?.kind === 'Identifier') {
      context.container.push(
        field.value.kind === 'FunctionExpression'
          ? functionSymbol(field.key.name, 'function', field, field.key, field.value, context)
          : valueSymbol(field.key.name, 'field', field, field.key, field.value, context),
      );
    } else {
      if (field.key) expression(field.key, context);
      expression(field.value, context);
    }
  }
}

/** Finds functions nested in an expression (callbacks, table fields, …). */
function expression(node: Ast.Expression, context: Context): void {
  switch (node.kind) {
    case 'FunctionExpression':
      block(node.body, inFunction(context, context.container));
      break;
    case 'TableConstructor':
      for (const field of node.fields) {
        if (field.form === 'keyed' && field.key) expression(field.key, context);
        expression(field.value, context);
      }
      break;
    case 'BinaryExpression':
      expression(node.left, context);
      expression(node.right, context);
      break;
    case 'UnaryExpression':
      expression(node.argument, context);
      break;
    case 'ParenthesizedExpression':
      expression(node.expression, context);
      break;
    case 'MemberExpression':
      expression(node.base, context);
      break;
    case 'IndexExpression':
      expression(node.base, context);
      expression(node.index, context);
      break;
    case 'CallExpression':
    case 'MethodCallExpression':
      expression(node.base, context);
      for (const argument of node.arguments.values) expression(argument, context);
      break;
    default:
      break;
  }
}

function block(node: Ast.Block, context: Context): void {
  for (const statement of node.body) {
    visit(statement, context);
  }
}

function visit(node: Ast.Statement, context: Context): void {
  switch (node.kind) {
    case 'LocalStatement':
      node.names.forEach((name, index) => {
        const value = node.values[index];
        if (value?.kind === 'FunctionExpression') {
          context.container.push(functionSymbol(name.name, 'function', node, name, value, context));
        } else if (context.topLevel) {
          context.container.push(valueSymbol(name.name, 'variable', node, name, value, context));
        } else if (value) {
          expression(value, context);
        }
      });
      for (const value of node.values.slice(node.names.length)) expression(value, context);
      break;
    case 'LocalFunctionStatement':
      context.container.push(functionSymbol(node.name.name, 'function', node, node.name, node.func, context));
      break;
    case 'FunctionDeclaration': {
      const [first] = node.path;
      const last = node.method ?? node.path.at(-1);
      if (!first || !last) break;
      const path = node.path.map((p) => p.name).join('.');
      const name = node.method ? `${path}:${node.method.name}` : path;
      context.container.push(
        functionSymbol(name, node.method ? 'method' : 'function', node, { start: first.start, end: last.end }, node.func, context),
      );
      break;
    }
    case 'AssignmentStatement':
      node.targets.forEach((target, index) => {
        const value = node.values[index];
        const name = dottedName(target);
        if (value?.kind === 'FunctionExpression' && name !== undefined) {
          context.container.push(functionSymbol(name, 'function', node, target, value, context));
          return;
        }
        if (
          target.kind === 'Identifier' &&
          context.listGlobals &&
          !context.scopes.resolved.has(target) &&
          !context.seenGlobals.has(target.name)
        ) {
          context.seenGlobals.add(target.name);
          context.container.push(valueSymbol(target.name, 'variable', node, target, value, context));
          return;
        }
        expression(target, context);
        if (value) expression(value, context);
      });
      for (const value of node.values.slice(node.targets.length)) expression(value, context);
      break;
    case 'CallStatement':
      expression(node.call, context);
      break;
    case 'DoStatement':
      block(node.body, nested(context, context.container));
      break;
    case 'WhileStatement':
      expression(node.condition, context);
      block(node.body, nested(context, context.container));
      break;
    case 'RepeatStatement':
      block(node.body, nested(context, context.container));
      if (node.condition) expression(node.condition, context);
      break;
    case 'IfStatement':
      for (const clause of node.clauses) {
        if (clause.condition) expression(clause.condition, context);
        block(clause.body, nested(context, context.container));
      }
      break;
    case 'NumericForStatement':
      for (const value of [node.initial, node.limit, node.step]) if (value) expression(value, context);
      block(node.body, nested(context, context.container));
      break;
    case 'GenericForStatement':
      for (const value of node.iterators) expression(value, context);
      block(node.body, nested(context, context.container));
      break;
    case 'ReturnStatement':
      for (const value of node.values) expression(value, context);
      break;
    case 'BreakStatement':
    case 'GotoStatement':
    case 'LabelStatement':
      break;
  }
}

function chunkSymbols(parsed: ParsedChunk, container: OutlineSymbol[], seenGlobals: Set<string>): void {
  const script = parsed.chunk.origin === 'property';
  block(parsed.tree.body, {
    container,
    scopes: parsed.scopes,
    topLevel: !script,
    listGlobals: !script,
    seenGlobals,
  });
}

/** The outline of a parsed document, in document order. */
export function documentSymbols(document: ParsedDocument, textLength: number): OutlineSymbol[] {
  const root: OutlineSymbol[] = [];
  const seenGlobals = new Set<string>();
  const menus: OutlineSymbol[] = [];
  for (const block of document.blocks) {
    if (block.keyword?.text.toLowerCase() !== 'menu') continue;
    const { keyword } = block;
    const name = block.name && block.name.text.trim() !== '' ? block.name : keyword;
    const menu: OutlineSymbol = {
      name: name.text,
      kind: 'namespace',
      detail: undefined,
      start: keyword.start,
      end: block.close === undefined ? textLength : block.close + 1,
      selectionStart: name.start,
      selectionEnd: name.end,
      children: [],
    };
    menus.push(menu);
    root.push(menu);
  }
  for (const parsed of document.chunks) {
    const offset = parsed.chunk.offset;
    const menu = menus.find((m) => m.start <= offset && offset < m.end);
    chunkSymbols(parsed, menu?.children ?? root, seenGlobals);
  }
  root.sort((a, b) => a.start - b.start);
  return root;
}
