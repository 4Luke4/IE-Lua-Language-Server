// Error-tolerant Lua 5.2 parser: recursive descent over the grammar of the Lua
// 5.2 manual (§9), mirroring the official parser (lua-5.2.4/src/lparser.c) for
// what it accepts. Pure: no LSP or `vscode` imports.
//
// The tree feeds editor features (symbols, folding, …). Diagnostics still come
// only from the official compiler (src/server/validation/), so this parser
// publishes nothing; `Chunk.errors` only tells callers whether the tree is
// complete. Never throws: after an error it skips to the next statement and
// keeps going, so features keep working while the user types.
//
// Checks of lparser.c that are done: the grammar, operator precedence, `...`
// outside a vararg function, `break` outside a loop, and the nesting limit
// (LUAI_MAXCCALLS). Checks that are NOT done (code-generation limits and goto
// semantics): labels (duplicates, visibility, jumps into the scope of a local),
// and the limits on locals (200), upvalues (255), registers and constants.

import type * as Ast from './ast.ts';
import { lex, type ParseError, type Token } from './lexer.ts';

export interface ParseOptions {
  /** First offset of the chunk in `source` (default 0). */
  readonly from?: number;
  /** End offset of the chunk in `source` (default `source.length`). */
  readonly to?: number;
  /**
   * `statements` (default): a chunk. `expression`: a value the engine evaluates
   * (`enabled "…"` in .menu files), parsed as if preceded by `return `.
   */
  readonly mode?: 'statements' | 'expression';
  /**
   * Parse the code as the body of `function f () <code> end`, the shape in which
   * the engine compiles .menu property code: `...` is not allowed (the function
   * is not vararg), and every statement is one level deeper (`enterlevel` of the
   * enclosing `function` statement). Default `false`: a top-level chunk.
   */
  readonly functionBody?: boolean;
}

/** lparser.c `priority`: [left, right]; right < left means right-associative. */
const BINARY_PRIORITY: Readonly<Record<Ast.BinaryOperator, readonly [number, number]>> = {
  '+': [6, 6], '-': [6, 6],
  '*': [7, 7], '/': [7, 7], '%': [7, 7],
  '^': [10, 9],
  '..': [5, 4],
  '==': [3, 3], '<': [3, 3], '<=': [3, 3], '~=': [3, 3], '>': [3, 3], '>=': [3, 3],
  'and': [2, 2],
  'or': [1, 1],
};
const UNARY_PRIORITY = 8;
/** luaconf.h LUAI_MAXCCALLS: nesting limit enforced by lparser.c `enterlevel`. */
export const MAX_SYNTAX_LEVELS = 200;

const STATEMENT_KEYWORDS: ReadonlySet<string> = new Set([
  'break', 'do', 'for', 'function', 'goto', 'if', 'local', 'repeat', 'return', 'while',
]);

/**
 * Thrown to abandon the statement being parsed; the error is already recorded.
 * One shared instance: it is always caught inside this module, so no stack is needed.
 */
const ABORT = new Error('Lua parse aborted');

interface FunctionState {
  readonly isVararg: boolean;
  loopDepth: number;
}

class Parser {
  readonly errors: ParseError[] = [];
  private readonly tokens: readonly Token[];
  private readonly eof: Token;
  private readonly source: string;
  private p = 0;
  /** End offset of the last consumed token. */
  private previousEnd: number;
  private level = 0;
  private readonly functions: FunctionState[] = [];
  /** `ParseOptions.functionBody`. */
  private readonly insideFunction: boolean;

  constructor(source: string, tokens: readonly Token[], from: number, to: number, functionBody: boolean) {
    this.source = source;
    this.insideFunction = functionBody;
    this.tokens = tokens;
    this.eof = tokens.at(-1) ?? { type: 'eof', value: '<eof>', start: to, end: to };
    this.previousEnd = from;
  }

  // ------------------------------------------------------------- token stream

  private get token(): Token {
    return this.tokens[this.p] ?? this.eof;
  }

  private lookahead(): Token {
    return this.tokens[this.p + 1] ?? this.eof;
  }

  private advance(): Token {
    const token = this.token;
    if (token.type !== 'eof') {
      this.p++;
      this.previousEnd = token.end;
    }
    return token;
  }

  /** Current token is the keyword or symbol `value`. */
  private check(value: string): boolean {
    const { type } = this.token;
    return (type === 'keyword' || type === 'symbol') && this.token.value === value;
  }

  private accept(value: string): Token | undefined {
    return this.check(value) ? this.advance() : undefined;
  }

  private near(token: Token = this.token): string {
    return token.type === 'eof' ? 'near <eof>' : `near '${token.value}'`;
  }

  private record(message: string, token: Token = this.token): void {
    this.errors.push({ start: token.start, end: token.end, message: `${message} ${this.near(token)}` });
  }

  private fail(message: string, token: Token = this.token): never {
    this.record(message, token);
    throw ABORT;
  }

  private expect(value: string): Token {
    return this.accept(value) ?? this.fail(`'${value}' expected`);
  }

  /** Closing keyword of a construct. A missing one is recorded but does not abandon the construct. */
  private close(value: string, opener: string): number | undefined {
    const token = this.accept(value);
    if (!token) {
      this.record(`'${value}' expected (to close '${opener}')`);
    }
    return token?.start;
  }

  private name(): Ast.Identifier {
    const token = this.token;
    if (token.type !== 'name') {
      this.fail('<name> expected');
    }
    this.advance();
    return { kind: 'Identifier', name: token.value, start: token.start, end: token.end };
  }

  private enterLevel(): void {
    if (++this.level > MAX_SYNTAX_LEVELS) {
      this.fail(`too many C levels (limit is ${MAX_SYNTAX_LEVELS})`);
    }
  }

  private get currentFunction(): FunctionState {
    // The chunk's own state is pushed before parsing starts and never popped.
    return this.functions.at(-1) ?? { isVararg: true, loopDepth: 0 };
  }

  private blockFollow(withUntil: boolean): boolean {
    const { type, value } = this.token;
    if (type === 'eof') return true;
    if (type !== 'keyword') return false;
    return value === 'else' || value === 'elseif' || value === 'end' || (withUntil && value === 'until');
  }

  /** Skips to a token that can plausibly start a statement or end a block. */
  private synchronize(startIndex: number): void {
    if (this.p === startIndex) {
      this.advance();
    }
    while (this.token.type !== 'eof') {
      const token = this.token;
      if (token.type === 'keyword' && (STATEMENT_KEYWORDS.has(token.value) || this.blockFollow(true))) return;
      if (this.check(';') || this.check('::')) return;
      // A name or `(` that starts a line probably starts a new statement.
      const previous = this.tokens[this.p - 1];
      if ((token.type === 'name' || this.check('(')) && previous && /[\n\r]/.test(this.source.slice(previous.end, token.start))) return;
      this.advance();
    }
  }

  // --------------------------------------------------------------- chunks

  /** Enters the function the chunk is compiled as (see `ParseOptions.functionBody`). */
  private enterChunk(): void {
    this.functions.push({ isVararg: !this.insideFunction, loopDepth: 0 });
    if (this.insideFunction) this.enterLevel();
  }

  chunk(from: number): Ast.Block {
    this.enterChunk();
    const body: Ast.Statement[] = [];
    for (;;) {
      body.push(...this.statementList());
      if (this.token.type === 'eof') break;
      // A stray `end`, `until`, … at the top level, or code after `return`.
      this.record("'<eof>' expected");
      this.advance();
    }
    return { kind: 'Block', body, start: from, end: this.previousEnd };
  }

  /** `return <explist> [;]` followed by the end of the chunk. */
  expressionChunk(from: number): Ast.Block {
    this.enterChunk();
    const body: Ast.Statement[] = [];
    try {
      // The implied `return` is a statement: lparser.c `statement` enters a level.
      this.enterLevel();
      const values = this.token.type === 'eof' || this.check(';') ? [] : this.expressionList();
      this.accept(';');
      body.push({ kind: 'ReturnStatement', values, start: from, end: this.previousEnd });
      if (this.token.type !== 'eof') {
        this.record("'<eof>' expected");
      }
    } catch (error) {
      if (error !== ABORT) throw error;
    }
    return { kind: 'Block', body, start: from, end: this.previousEnd };
  }

  // ----------------------------------------------------------- statements

  private block(): Ast.Block {
    const start = this.token.start;
    const body = this.statementList();
    return { kind: 'Block', body, start, end: Math.max(start, this.previousEnd) };
  }

  /** lparser.c `statlist`: statements up to a block end; `return` must be last. */
  private statementList(): Ast.Statement[] {
    const body: Ast.Statement[] = [];
    while (!this.blockFollow(true)) {
      const isReturn = this.check('return');
      const startIndex = this.p;
      try {
        const statement = this.statement();
        if (statement) body.push(statement);
      } catch (error) {
        if (error !== ABORT) throw error;
        this.synchronize(startIndex);
        continue;
      }
      if (isReturn) break;
    }
    return body;
  }

  private loopBody(): Ast.Block {
    const fn = this.currentFunction;
    fn.loopDepth++;
    try {
      return this.block();
    } finally {
      fn.loopDepth--;
    }
  }

  private statement(): Ast.Statement | undefined {
    const level = this.level;
    try {
      this.enterLevel();
      return this.statementBody();
    } finally {
      this.level = level;
    }
  }

  private statementBody(): Ast.Statement | undefined {
    const token = this.token;
    const start = token.start;
    if (token.type === 'keyword') {
      switch (token.value) {
        case 'if':
          return this.ifStatement();
        case 'while': {
          this.advance();
          const condition = this.expression();
          this.expect('do');
          const body = this.loopBody();
          const closeStart = this.close('end', 'while');
          return { kind: 'WhileStatement', condition, body, closeStart, start, end: this.previousEnd };
        }
        case 'do': {
          this.advance();
          const body = this.block();
          const closeStart = this.close('end', 'do');
          return { kind: 'DoStatement', body, closeStart, start, end: this.previousEnd };
        }
        case 'for':
          return this.forStatement();
        case 'repeat': {
          this.advance();
          const body = this.loopBody();
          const closeStart = this.close('until', 'repeat');
          const condition = closeStart === undefined ? undefined : this.expression();
          return { kind: 'RepeatStatement', body, condition, closeStart, start, end: this.previousEnd };
        }
        case 'function': {
          this.advance();
          const path = [this.name()];
          while (this.accept('.')) path.push(this.name());
          const method = this.accept(':') ? this.name() : undefined;
          const func = this.functionBody(start);
          return { kind: 'FunctionDeclaration', path, method, func, start, end: this.previousEnd };
        }
        case 'local': {
          this.advance();
          if (this.accept('function')) {
            const name = this.name();
            const func = this.functionBody(start);
            return { kind: 'LocalFunctionStatement', name, func, start, end: this.previousEnd };
          }
          const names = [this.name()];
          while (this.accept(',')) names.push(this.name());
          const values = this.accept('=') ? this.expressionList() : [];
          return { kind: 'LocalStatement', names, values, start, end: this.previousEnd };
        }
        case 'return': {
          this.advance();
          const values = this.blockFollow(true) || this.check(';') ? [] : this.expressionList();
          this.accept(';');
          return { kind: 'ReturnStatement', values, start, end: this.previousEnd };
        }
        case 'break':
          this.advance();
          if (this.currentFunction.loopDepth === 0) {
            this.errors.push({ start, end: token.end, message: "'break' not inside a loop" });
          }
          return { kind: 'BreakStatement', start, end: this.previousEnd };
        case 'goto': {
          this.advance();
          const label = this.name();
          return { kind: 'GotoStatement', label, start, end: this.previousEnd };
        }
        default:
          break;
      }
    }
    if (this.accept(';')) {
      return undefined;
    }
    if (this.accept('::')) {
      const label = this.name();
      this.expect('::');
      return { kind: 'LabelStatement', label, start, end: this.previousEnd };
    }
    return this.expressionStatement();
  }

  private ifStatement(): Ast.IfStatement {
    const start = this.token.start;
    const clauses: Ast.IfClause[] = [];
    const conditional = (keyword: 'if' | 'elseif'): void => {
      const clauseStart = this.advance().start;
      const condition = this.expression();
      this.expect('then');
      const body = this.block();
      clauses.push({ kind: 'IfClause', keyword, condition, body, start: clauseStart, end: this.previousEnd });
    };
    conditional('if');
    while (this.check('elseif')) conditional('elseif');
    if (this.check('else')) {
      const clauseStart = this.advance().start;
      const body = this.block();
      clauses.push({ kind: 'IfClause', keyword: 'else', condition: undefined, body, start: clauseStart, end: this.previousEnd });
    }
    const closeStart = this.close('end', 'if');
    return { kind: 'IfStatement', clauses, closeStart, start, end: this.previousEnd };
  }

  private forStatement(): Ast.NumericForStatement | Ast.GenericForStatement {
    const start = this.advance().start;
    const first = this.name();
    if (this.accept('=')) {
      const initial = this.expression();
      this.expect(',');
      const limit = this.expression();
      const step = this.accept(',') ? this.expression() : undefined;
      this.expect('do');
      const body = this.loopBody();
      const closeStart = this.close('end', 'for');
      return { kind: 'NumericForStatement', variable: first, initial, limit, step, body, closeStart, start, end: this.previousEnd };
    }
    if (!this.check(',') && !this.check('in')) {
      this.fail("'=' or 'in' expected");
    }
    const variables = [first];
    while (this.accept(',')) variables.push(this.name());
    this.expect('in');
    const iterators = this.expressionList();
    this.expect('do');
    const body = this.loopBody();
    const closeStart = this.close('end', 'for');
    return { kind: 'GenericForStatement', variables, iterators, body, closeStart, start, end: this.previousEnd };
  }

  /** lparser.c `exprstat`: an assignment or a function call. */
  private expressionStatement(): Ast.AssignmentStatement | Ast.CallStatement {
    const start = this.token.start;
    const first = this.suffixedExpression();
    if (this.check('=') || this.check(',')) {
      const targets = [this.assignable(first)];
      while (this.accept(',')) targets.push(this.assignable(this.suffixedExpression()));
      this.expect('=');
      const values = this.expressionList();
      return { kind: 'AssignmentStatement', targets, values, start, end: this.previousEnd };
    }
    if (first.kind !== 'CallExpression' && first.kind !== 'MethodCallExpression') {
      this.fail('syntax error');
    }
    return { kind: 'CallStatement', call: first, start, end: this.previousEnd };
  }

  private assignable(target: Ast.Expression): Ast.Expression {
    if (target.kind !== 'Identifier' && target.kind !== 'MemberExpression' && target.kind !== 'IndexExpression') {
      this.fail('syntax error');
    }
    return target;
  }

  /** `(params) block end`; `start` is the offset of `function` (or `local`). */
  private functionBody(start: number): Ast.FunctionExpression {
    this.expect('(');
    const parameters: Ast.Identifier[] = [];
    let isVararg = false;
    if (!this.check(')')) {
      do {
        if (this.accept('...')) {
          isVararg = true;
        } else if (this.token.type === 'name') {
          parameters.push(this.name());
        } else {
          this.fail('<name> expected');
        }
      } while (!isVararg && this.accept(','));
    }
    this.expect(')');
    this.functions.push({ isVararg, loopDepth: 0 });
    let body: Ast.Block;
    try {
      body = this.block();
    } finally {
      this.functions.pop();
    }
    const closeStart = this.close('end', 'function');
    return { kind: 'FunctionExpression', parameters, isVararg, body, closeStart, start, end: this.previousEnd };
  }

  // ---------------------------------------------------------- expressions

  private expressionList(): Ast.Expression[] {
    const values = [this.expression()];
    while (this.accept(',')) values.push(this.expression());
    return values;
  }

  private expression(): Ast.Expression {
    return this.subexpression(0);
  }

  private binaryOperator(): Ast.BinaryOperator | undefined {
    const { type, value } = this.token;
    if ((type === 'symbol' || type === 'keyword') && Object.hasOwn(BINARY_PRIORITY, value)) {
      return value as Ast.BinaryOperator;
    }
    return undefined;
  }

  /** lparser.c `subexpr`: operators with a left priority above `limit`. */
  private subexpression(limit: number): Ast.Expression {
    const level = this.level;
    try {
      this.enterLevel();
      const start = this.token.start;
      let left: Ast.Expression;
      if (this.check('not') || this.check('-') || this.check('#')) {
        const operator = this.advance().value as Ast.UnaryOperator;
        const argument = this.subexpression(UNARY_PRIORITY);
        left = { kind: 'UnaryExpression', operator, argument, start, end: this.previousEnd };
      } else {
        left = this.simpleExpression();
      }
      for (let operator = this.binaryOperator(); operator && BINARY_PRIORITY[operator][0] > limit; operator = this.binaryOperator()) {
        this.advance();
        const right = this.subexpression(BINARY_PRIORITY[operator][1]);
        left = { kind: 'BinaryExpression', operator, left, right, start, end: this.previousEnd };
      }
      return left;
    } finally {
      this.level = level;
    }
  }

  private simpleExpression(): Ast.Expression {
    const token = this.token;
    const { start, end } = token;
    switch (token.type) {
      case 'number':
        this.advance();
        return { kind: 'NumberLiteral', raw: token.value, start, end };
      case 'string':
        this.advance();
        return { kind: 'StringLiteral', raw: token.value, start, end };
      case 'keyword':
        if (token.value === 'nil') {
          this.advance();
          return { kind: 'NilLiteral', start, end };
        }
        if (token.value === 'true' || token.value === 'false') {
          this.advance();
          return { kind: 'BooleanLiteral', value: token.value === 'true', start, end };
        }
        if (token.value === 'function') {
          this.advance();
          return this.functionBody(start);
        }
        break;
      case 'symbol':
        if (token.value === '...') {
          if (!this.currentFunction.isVararg) {
            this.fail("cannot use '...' outside a vararg function");
          }
          this.advance();
          return { kind: 'VarargLiteral', start, end };
        }
        if (token.value === '{') {
          return this.tableConstructor();
        }
        break;
      default:
        break;
    }
    return this.suffixedExpression();
  }

  private primaryExpression(): Ast.Expression {
    const token = this.token;
    if (token.type === 'name') {
      return this.name();
    }
    if (this.accept('(')) {
      const expression = this.expression();
      this.expect(')');
      return { kind: 'ParenthesizedExpression', expression, start: token.start, end: this.previousEnd };
    }
    this.fail('unexpected symbol');
  }

  private suffixedExpression(): Ast.Expression {
    const start = this.token.start;
    let expression = this.primaryExpression();
    for (;;) {
      if (this.accept('.')) {
        const member = this.name();
        expression = { kind: 'MemberExpression', base: expression, member, start, end: this.previousEnd };
      } else if (this.accept('[')) {
        const index = this.expression();
        this.expect(']');
        expression = { kind: 'IndexExpression', base: expression, index, start, end: this.previousEnd };
      } else if (this.accept(':')) {
        const method = this.name();
        const args = this.callArguments();
        expression = { kind: 'MethodCallExpression', base: expression, method, arguments: args, start, end: this.previousEnd };
      } else if (this.check('(') || this.check('{') || this.token.type === 'string') {
        const args = this.callArguments();
        expression = { kind: 'CallExpression', base: expression, arguments: args, start, end: this.previousEnd };
      } else {
        return expression;
      }
    }
  }

  private callArguments(): Ast.CallArguments {
    const token = this.token;
    if (token.type === 'string') {
      this.advance();
      const value: Ast.StringLiteral = { kind: 'StringLiteral', raw: token.value, start: token.start, end: token.end };
      return { form: 'string', values: [value], start: token.start, closeStart: undefined };
    }
    if (this.check('{')) {
      return { form: 'table', values: [this.tableConstructor()], start: token.start, closeStart: undefined };
    }
    if (this.accept('(')) {
      const values = this.check(')') ? [] : this.expressionList();
      const closeStart = this.expect(')').start;
      return { form: 'parentheses', values, start: token.start, closeStart };
    }
    this.fail('function arguments expected');
  }

  private tableConstructor(): Ast.TableConstructor {
    const start = this.expect('{').start;
    const fields: Ast.TableField[] = [];
    while (!this.check('}')) {
      const fieldStart = this.token.start;
      if (this.token.type === 'name' && this.lookahead().type === 'symbol' && this.lookahead().value === '=') {
        const key = this.name();
        this.advance();
        const value = this.expression();
        fields.push({ kind: 'TableField', form: 'named', key, value, start: fieldStart, end: this.previousEnd });
      } else if (this.accept('[')) {
        const key = this.expression();
        this.expect(']');
        this.expect('=');
        const value = this.expression();
        fields.push({ kind: 'TableField', form: 'keyed', key, value, start: fieldStart, end: this.previousEnd });
      } else {
        const value = this.expression();
        fields.push({ kind: 'TableField', form: 'item', key: undefined, value, start: fieldStart, end: this.previousEnd });
      }
      if (!this.accept(',') && !this.accept(';')) break;
    }
    const closeStart = this.expect('}').start;
    return { kind: 'TableConstructor', fields, closeStart, start, end: this.previousEnd };
  }
}

/** Parses `source[from, to)` into a syntax tree. Never throws. */
export function parseChunk(source: string, options: ParseOptions = {}): Ast.Chunk {
  const from = options.from ?? 0;
  const to = options.to ?? source.length;
  const { tokens, comments, errors: lexErrors } = lex(source, from, to);
  const parser = new Parser(source, tokens, from, to, options.functionBody ?? false);
  const body = options.mode === 'expression' ? parser.expressionChunk(from) : parser.chunk(from);
  const errors = [...lexErrors, ...parser.errors].sort((a, b) => a.start - b.start);
  return { kind: 'Chunk', body, comments, errors, start: from, end: to };
}
