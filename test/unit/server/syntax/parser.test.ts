import assert from 'node:assert/strict';
import type * as Ast from '../../../../src/server/syntax/ast.ts';
import { MAX_SYNTAX_LEVELS, parseChunk } from '../../../../src/server/syntax/parser.ts';

/** Compact S-expression of an expression, to make precedence and structure readable. */
function sexp(e: Ast.Expression | undefined): string {
  if (!e) return '_';
  switch (e.kind) {
    case 'NilLiteral': return 'nil';
    case 'BooleanLiteral': return String(e.value);
    case 'NumberLiteral':
    case 'StringLiteral': return e.raw;
    case 'VarargLiteral': return '...';
    case 'Identifier': return e.name;
    case 'FunctionExpression': return `(function (${e.parameters.map((p) => p.name).join(' ')}${e.isVararg ? ' ...' : ''}) ${e.body.body.length})`;
    case 'TableConstructor': return `{${e.fields.map((f) => (f.form === 'item' ? sexp(f.value) : `${f.form === 'named' ? sexp(f.key) : `[${sexp(f.key)}]`}=${sexp(f.value)}`)).join(' ')}}`;
    case 'BinaryExpression': return `(${e.operator} ${sexp(e.left)} ${sexp(e.right)})`;
    case 'UnaryExpression': return `(${e.operator} ${sexp(e.argument)})`;
    case 'ParenthesizedExpression': return `(paren ${sexp(e.expression)})`;
    case 'MemberExpression': return `${sexp(e.base)}.${e.member.name}`;
    case 'IndexExpression': return `${sexp(e.base)}[${sexp(e.index)}]`;
    case 'CallExpression': return `(call ${sexp(e.base)}${e.arguments.values.map((v) => ` ${sexp(v)}`).join('')})`;
    case 'MethodCallExpression': return `(call ${sexp(e.base)}:${e.method.name}${e.arguments.values.map((v) => ` ${sexp(v)}`).join('')})`;
  }
}

function only(source: string): Ast.Statement {
  const chunk = parseChunk(source);
  assert.deepEqual(chunk.errors, [], source);
  assert.equal(chunk.body.body.length, 1, source);
  const [statement] = chunk.body.body;
  assert.ok(statement);
  return statement;
}

function value(source: string): string {
  const statement = only(`x = ${source}`);
  assert.equal(statement.kind, 'AssignmentStatement');
  return sexp(statement.values[0]);
}

describe('server/syntax/parser', () => {
  describe('expressions', () => {
    it('applies the Lua 5.2 operator precedence', () => {
      assert.equal(value('a or b and c'), '(or a (and b c))');
      assert.equal(value('a < b == c'), '(== (< a b) c)');
      assert.equal(value('a .. b + c'), '(.. a (+ b c))');
      assert.equal(value('a + b * c % d'), '(+ a (% (* b c) d))');
      assert.equal(value('not a == b'), '(== (not a) b)');
      assert.equal(value('-x ^ 2'), '(- (^ x 2))');
      assert.equal(value('#t - 1'), '(- (# t) 1)');
    });

    it('makes .. and ^ right-associative and the others left-associative', () => {
      assert.equal(value('a .. b .. c'), '(.. a (.. b c))');
      assert.equal(value('a ^ b ^ c'), '(^ a (^ b c))');
      assert.equal(value('a - b - c'), '(- (- a b) c)');
      assert.equal(value('2 ^ -3 ^ 2'), '(^ 2 (- (^ 3 2)))');
    });

    it('parses literals, varargs, functions and table constructors', () => {
      assert.equal(value('nil'), 'nil');
      assert.equal(value('false'), 'false');
      assert.equal(value('0x1p4'), '0x1p4');
      assert.equal(value('[[s]]'), '[[s]]');
      assert.equal(value('...'), '...');
      assert.equal(value('function(a, b, ...) return a end'), '(function (a b ...) 1)');
      assert.equal(value('{1, x = 2; [k] = 3,}'), '{1 x=2 [k]=3}');
    });

    it('parses suffixes: members, indexes, calls and method calls in every argument form', () => {
      assert.equal(value('a.b[c]:d(e)("f"){g}'), '(call (call (call a.b[c]:d e) "f") {g})');
      assert.equal(value('(f)()'), '(call (paren f))');
      assert.equal(value("s:format'x'"), "(call s:format 'x')");
    });

    it('records the offsets of every node in the source', () => {
      const source = 'x = a.b + f(1)';
      const statement = only(source);
      assert.equal(statement.kind, 'AssignmentStatement');
      const sum = statement.values[0];
      assert.ok(sum?.kind === 'BinaryExpression');
      assert.equal(source.slice(sum.start, sum.end), 'a.b + f(1)');
      assert.equal(source.slice(sum.left.start, sum.left.end), 'a.b');
      assert.ok(sum.right.kind === 'CallExpression');
      assert.equal(sum.right.arguments.closeStart, source.length - 1);
    });
  });

  describe('statements', () => {
    it('parses local declarations, assignments and calls', () => {
      const local = only('local a, b = 1, 2');
      assert.ok(local.kind === 'LocalStatement');
      assert.deepEqual(local.names.map((n) => n.name), ['a', 'b']);
      assert.deepEqual(local.values.map(sexp), ['1', '2']);

      const assignment = only('a, t.b, t[1] = f()');
      assert.ok(assignment.kind === 'AssignmentStatement');
      assert.deepEqual(assignment.targets.map(sexp), ['a', 't.b', 't[1]']);

      assert.equal(only('obj:method(1)').kind, 'CallStatement');
    });

    it('parses function declarations with dotted paths and methods', () => {
      const declaration = only('function a.b.c:m(x) end');
      assert.ok(declaration.kind === 'FunctionDeclaration');
      assert.deepEqual(declaration.path.map((n) => n.name), ['a', 'b', 'c']);
      assert.equal(declaration.method?.name, 'm');
      assert.deepEqual(declaration.func.parameters.map((p) => p.name), ['x']);

      const local = only('local function f() end');
      assert.ok(local.kind === 'LocalFunctionStatement');
      assert.equal(local.name.name, 'f');
      assert.equal(local.func.start, 0, 'a local function starts at `local`');
    });

    it('parses every control structure and records its closing keyword', () => {
      const source = 'if a then elseif b then else end';
      const statement = only(source);
      assert.ok(statement.kind === 'IfStatement');
      assert.deepEqual(statement.clauses.map((c) => [c.keyword, source.slice(c.start, c.start + c.keyword.length)]), [
        ['if', 'if'],
        ['elseif', 'elseif'],
        ['else', 'else'],
      ]);
      assert.equal(statement.closeStart, source.length - 3);

      for (const [code, kind] of [
        ['while x do end', 'WhileStatement'],
        ['do end', 'DoStatement'],
        ['repeat local y until y', 'RepeatStatement'],
        ['for i = 1, 10, 2 do end', 'NumericForStatement'],
        ['for k, v in pairs(t) do end', 'GenericForStatement'],
        ['goto done', 'GotoStatement'],
        ['::done::', 'LabelStatement'],
        ['return 1, 2', 'ReturnStatement'],
      ] as const) {
        assert.equal(only(code).kind, kind, code);
      }
      assert.equal(only('while true do break end').kind, 'WhileStatement');
    });

    it('ignores empty statements', () => {
      const chunk = parseChunk(';;local x = 1;;');
      assert.deepEqual(chunk.errors, []);
      assert.equal(chunk.body.body.length, 1);
    });
  });

  describe('compiler checks', () => {
    const rejects = (source: string, message: RegExp): void => {
      const { errors } = parseChunk(source);
      assert.ok(errors.some((e) => message.test(e.message)), `${source}: ${JSON.stringify(errors)}`);
    };

    it('rejects ... outside a vararg function, but not in the main chunk', () => {
      rejects('function f() return ... end', /cannot use '\.\.\.' outside a vararg function/);
      assert.deepEqual(parseChunk('return ...').errors, []);
      assert.deepEqual(parseChunk('local function f(...) return function(...) return ... end end').errors, []);
    });

    it('rejects break outside a loop, including in a function nested in a loop', () => {
      rejects('break', /'break' not inside a loop/);
      rejects('while x do local function f() break end end', /'break' not inside a loop/);
    });

    it('rejects assignments to non-variables and expressions used as statements', () => {
      rejects('(a) = 1', /syntax error/);
      rejects('f() = 1', /syntax error/);
      rejects('a.b', /syntax error/);
    });

    it('requires return to be the last statement of its block', () => {
      rejects('return 1 x()', /'<eof>' expected/);
      assert.deepEqual(parseChunk('do return end x()').errors, []);
    });

    it(`limits nesting to LUAI_MAXCCALLS (${MAX_SYNTAX_LEVELS}) syntax levels`, () => {
      const nested = (n: number): string => 'do '.repeat(n) + 'end '.repeat(n);
      assert.deepEqual(parseChunk(nested(MAX_SYNTAX_LEVELS)).errors, []);
      rejects(nested(MAX_SYNTAX_LEVELS + 1), /too many C levels/);
    });
  });

  describe('error tolerance', () => {
    it('never throws, whatever the input', () => {
      for (const source of ['', ')', 'end end', 'function', 'local', 'x = ', '{{{', 'if if if', '"', '[[', '::']) {
        assert.ok(parseChunk(source).errors.length > 0 || source === '', source);
      }
    });

    it('keeps the statements around a broken one', () => {
      const chunk = parseChunk('local a = 1\nx = = 2\nlocal function f() end\n');
      assert.equal(chunk.errors.length, 1);
      assert.deepEqual(chunk.body.body.map((s) => s.kind), ['LocalStatement', 'LocalFunctionStatement']);
    });

    it('keeps a function whose end is missing, with its body', () => {
      const chunk = parseChunk('function f()\n  local x = 1\n');
      const [declaration] = chunk.body.body;
      assert.ok(declaration?.kind === 'FunctionDeclaration');
      assert.equal(declaration.func.closeStart, undefined);
      assert.equal(declaration.func.body.body.length, 1);
      assert.match(chunk.errors[0]?.message ?? '', /'end' expected \(to close 'function'\) near <eof>/);
    });

    it('recovers inside a function body without losing the function', () => {
      const chunk = parseChunk('function f()\n  x = = 1\n  y()\nend\nz()');
      assert.deepEqual(chunk.body.body.map((s) => s.kind), ['FunctionDeclaration', 'CallStatement']);
      const [declaration] = chunk.body.body;
      assert.ok(declaration?.kind === 'FunctionDeclaration');
      assert.deepEqual(declaration.func.body.body.map((s) => s.kind), ['CallStatement']);
      assert.notEqual(declaration.func.closeStart, undefined);
    });
  });

  describe('slices and expression mode', () => {
    it('parses a slice of a larger document with document offsets', () => {
      const source = 'action "f(1)" more';
      const chunk = parseChunk(source, { from: 8, to: 12 });
      assert.deepEqual(chunk.errors, []);
      assert.equal(chunk.start, 8);
      const [call] = chunk.body.body;
      assert.ok(call);
      assert.equal(source.slice(call.start, call.end), 'f(1)');
    });

    it('parses expression chunks as `return <explist>`', () => {
      const chunk = parseChunk('a == 1, b', { mode: 'expression' });
      assert.deepEqual(chunk.errors, []);
      const [statement] = chunk.body.body;
      assert.ok(statement?.kind === 'ReturnStatement');
      assert.deepEqual(statement.values.map(sexp), ['(== a 1)', 'b']);
      assert.deepEqual(parseChunk('', { mode: 'expression' }).errors, []);
      assert.ok(parseChunk('x = 1', { mode: 'expression' }).errors.length > 0);
    });
  });
});
