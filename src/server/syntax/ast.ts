// Syntax tree of a Lua 5.2 chunk (grammar: Lua 5.2 manual §9). Pure data: no
// LSP or `vscode` imports. Every node spans the half-open offsets `[start, end)`
// of the source it was parsed from (document offsets, see lexer.ts).
//
// Closing keywords (`end`, `until`, `)`, `]`, `}`) are recorded as `closeStart`,
// the offset of the keyword. It is `undefined` when the keyword is missing; the
// node then ends where parsing stopped.

import type { Comment, ParseError } from './lexer.ts';

interface Node {
  readonly start: number;
  readonly end: number;
}

export interface Chunk extends Node {
  readonly kind: 'Chunk';
  readonly body: Block;
  readonly comments: readonly Comment[];
  /** Lexical and syntax errors, in source order. Empty when the chunk is valid Lua 5.2 (see parser.ts for the checks that are not done). */
  readonly errors: readonly ParseError[];
}

export interface Block extends Node {
  readonly kind: 'Block';
  readonly body: readonly Statement[];
}

export interface Identifier extends Node {
  readonly kind: 'Identifier';
  readonly name: string;
}

// ---------------------------------------------------------------- statements

export interface LocalStatement extends Node {
  readonly kind: 'LocalStatement';
  readonly names: readonly Identifier[];
  readonly values: readonly Expression[];
}

export interface AssignmentStatement extends Node {
  readonly kind: 'AssignmentStatement';
  /** Each target is an `Identifier`, `MemberExpression` (`.` only) or `IndexExpression`. */
  readonly targets: readonly Expression[];
  readonly values: readonly Expression[];
}

export interface CallStatement extends Node {
  readonly kind: 'CallStatement';
  readonly call: CallExpression | MethodCallExpression;
}

export interface DoStatement extends Node {
  readonly kind: 'DoStatement';
  readonly body: Block;
  readonly closeStart: number | undefined;
}

export interface WhileStatement extends Node {
  readonly kind: 'WhileStatement';
  readonly condition: Expression;
  readonly body: Block;
  readonly closeStart: number | undefined;
}

export interface RepeatStatement extends Node {
  readonly kind: 'RepeatStatement';
  readonly body: Block;
  /** `undefined` when `until` is missing. */
  readonly condition: Expression | undefined;
  /** Offset of `until`. */
  readonly closeStart: number | undefined;
}

export interface IfClause extends Node {
  readonly kind: 'IfClause';
  /** `if`, `elseif` or `else`; `start` is the offset of that keyword. */
  readonly keyword: 'if' | 'elseif' | 'else';
  /** `undefined` for `else`. */
  readonly condition: Expression | undefined;
  readonly body: Block;
}

export interface IfStatement extends Node {
  readonly kind: 'IfStatement';
  readonly clauses: readonly IfClause[];
  readonly closeStart: number | undefined;
}

export interface NumericForStatement extends Node {
  readonly kind: 'NumericForStatement';
  readonly variable: Identifier;
  readonly initial: Expression;
  readonly limit: Expression;
  readonly step: Expression | undefined;
  readonly body: Block;
  readonly closeStart: number | undefined;
}

export interface GenericForStatement extends Node {
  readonly kind: 'GenericForStatement';
  readonly variables: readonly Identifier[];
  readonly iterators: readonly Expression[];
  readonly body: Block;
  readonly closeStart: number | undefined;
}

/** `function a.b.c:m() … end`. */
export interface FunctionDeclaration extends Node {
  readonly kind: 'FunctionDeclaration';
  /** `a`, `b`, `c` in `function a.b.c:m()`; at least one. */
  readonly path: readonly Identifier[];
  /** `m` in `function a.b.c:m()`. */
  readonly method: Identifier | undefined;
  readonly func: FunctionExpression;
}

/** `local function f() … end`. */
export interface LocalFunctionStatement extends Node {
  readonly kind: 'LocalFunctionStatement';
  readonly name: Identifier;
  readonly func: FunctionExpression;
}

export interface ReturnStatement extends Node {
  readonly kind: 'ReturnStatement';
  readonly values: readonly Expression[];
}

export interface BreakStatement extends Node {
  readonly kind: 'BreakStatement';
}

export interface GotoStatement extends Node {
  readonly kind: 'GotoStatement';
  readonly label: Identifier;
}

export interface LabelStatement extends Node {
  readonly kind: 'LabelStatement';
  readonly label: Identifier;
}

export type Statement =
  | LocalStatement
  | AssignmentStatement
  | CallStatement
  | DoStatement
  | WhileStatement
  | RepeatStatement
  | IfStatement
  | NumericForStatement
  | GenericForStatement
  | FunctionDeclaration
  | LocalFunctionStatement
  | ReturnStatement
  | BreakStatement
  | GotoStatement
  | LabelStatement;

// --------------------------------------------------------------- expressions

export interface NilLiteral extends Node {
  readonly kind: 'NilLiteral';
}

export interface BooleanLiteral extends Node {
  readonly kind: 'BooleanLiteral';
  readonly value: boolean;
}

export interface NumberLiteral extends Node {
  readonly kind: 'NumberLiteral';
  /** The numeral exactly as written. */
  readonly raw: string;
}

export interface StringLiteral extends Node {
  readonly kind: 'StringLiteral';
  /** The literal exactly as written, quotes or long brackets included. */
  readonly raw: string;
}

export interface VarargLiteral extends Node {
  readonly kind: 'VarargLiteral';
}

/** `function (params) … end`; also the body of declarations and local functions. */
export interface FunctionExpression extends Node {
  readonly kind: 'FunctionExpression';
  readonly parameters: readonly Identifier[];
  /** The parameter list ends with `...`. */
  readonly isVararg: boolean;
  readonly body: Block;
  readonly closeStart: number | undefined;
}

export interface TableField extends Node {
  readonly kind: 'TableField';
  /** `[k] = v` (`keyed`), `name = v` (`named`), or a positional `v` (`item`). */
  readonly form: 'keyed' | 'named' | 'item';
  /** Expression for `keyed`, `Identifier` for `named`, `undefined` for `item`. */
  readonly key: Expression | undefined;
  readonly value: Expression;
}

export interface TableConstructor extends Node {
  readonly kind: 'TableConstructor';
  readonly fields: readonly TableField[];
  readonly closeStart: number | undefined;
}

/** Binary operators of Lua 5.2 (manual §3.4). */
export type BinaryOperator =
  | 'or' | 'and'
  | '<' | '>' | '<=' | '>=' | '~=' | '=='
  | '..'
  | '+' | '-' | '*' | '/' | '%'
  | '^';

export type UnaryOperator = 'not' | '#' | '-';

export interface BinaryExpression extends Node {
  readonly kind: 'BinaryExpression';
  readonly operator: BinaryOperator;
  readonly left: Expression;
  readonly right: Expression;
}

export interface UnaryExpression extends Node {
  readonly kind: 'UnaryExpression';
  readonly operator: UnaryOperator;
  readonly argument: Expression;
}

export interface ParenthesizedExpression extends Node {
  readonly kind: 'ParenthesizedExpression';
  readonly expression: Expression;
}

/** `base.name`. */
export interface MemberExpression extends Node {
  readonly kind: 'MemberExpression';
  readonly base: Expression;
  readonly member: Identifier;
}

/** `base[index]`. */
export interface IndexExpression extends Node {
  readonly kind: 'IndexExpression';
  readonly base: Expression;
  readonly index: Expression;
}

/** Arguments of a call: `( … )`, a table constructor or a string literal. */
export interface CallArguments {
  readonly form: 'parentheses' | 'table' | 'string';
  readonly values: readonly Expression[];
  /** Offset of `(` (or of the table / string). */
  readonly start: number;
  /** Offset of `)`; `undefined` for the other forms or when `)` is missing. */
  readonly closeStart: number | undefined;
}

/** `base(args)`. */
export interface CallExpression extends Node {
  readonly kind: 'CallExpression';
  readonly base: Expression;
  readonly arguments: CallArguments;
}

/** `base:method(args)`. */
export interface MethodCallExpression extends Node {
  readonly kind: 'MethodCallExpression';
  readonly base: Expression;
  readonly method: Identifier;
  readonly arguments: CallArguments;
}

export type Expression =
  | NilLiteral
  | BooleanLiteral
  | NumberLiteral
  | StringLiteral
  | VarargLiteral
  | FunctionExpression
  | TableConstructor
  | BinaryExpression
  | UnaryExpression
  | ParenthesizedExpression
  | Identifier
  | MemberExpression
  | IndexExpression
  | CallExpression
  | MethodCallExpression;
