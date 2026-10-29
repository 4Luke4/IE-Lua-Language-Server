import assert from 'node:assert/strict';
import { parseChunk } from '../../../../src/server/syntax/parser.ts';
import { analyzeScopes, visibleAt, type ScopeAnalysis } from '../../../../src/server/syntax/scope.ts';

function analyze(source: string): ScopeAnalysis {
  const chunk = parseChunk(source);
  assert.deepEqual(chunk.errors, [], source);
  return analyzeScopes(chunk);
}

/**
 * For each declaration: `name@offset -> [offsets of its references]`, where
 * offset is the declaring identifier's offset (or `self`).
 */
function bindings(source: string): string[] {
  return analyze(source).declarations.map(
    (d) => `${d.name}@${d.identifier ? String(d.identifier.start) : d.kind} -> [${d.references.map((r) => r.start).join(',')}]`,
  );
}

const globalNames = (source: string): string[] => [...analyze(source).globals.keys()];

describe('server/syntax/scope', () => {
  it('makes `local x = x` refer to the outer x on the right-hand side', () => {
    //            0         1
    //            0123456789012345678
    const source = 'local x = 1 local x = x';
    assert.deepEqual(bindings(source), ['x@6 -> [22]', 'x@18 -> []']);
  });

  it('makes a local function visible inside its own body, unlike `local f = function`', () => {
    assert.deepEqual(bindings('local function f() return f() end'), ['f@15 -> [26]']);
    assert.deepEqual(globalNames('local f = function() return f() end'), ['f']);
  });

  it('scopes parameters and the implicit self to the function body', () => {
    const source = 'function t:m(a) return self, a end return a';
    assert.deepEqual(bindings(source), ['self@self -> [23]', 'a@13 -> [29]']);
    assert.deepEqual(globalNames(source), ['t', 'a']);
  });

  it('scopes for variables to the loop body, and evaluates the loop expressions outside it', () => {
    assert.deepEqual(bindings('local i = 1 for i = i, 2 do print(i) end'), ['i@6 -> [20]', 'i@16 -> [34]']);
    assert.deepEqual(bindings('for k, v in pairs(t) do f(k, v) end'), ['k@4 -> [26]', 'v@7 -> [29]']);
  });

  it('lets the until condition see the locals of the repeat body', () => {
    assert.deepEqual(bindings('repeat local done = true until done'), ['done@13 -> [31]']);
  });

  it('ends block scopes at their end keyword', () => {
    const source = 'do local x = 1 end x = 2';
    assert.deepEqual(bindings(source), ['x@9 -> []']);
    assert.deepEqual(globalNames(source), ['x']);
    assert.deepEqual(globalNames('if a then local b = 1 else c = b end'), ['a', 'c', 'b']);
  });

  it('resolves shadowing to the innermost declaration', () => {
    //            0         1         2         3         4
    //            01234567890123456789012345678901234567890123
    const source = 'local x = 1 do local x = 2 y = x end z = x';
    assert.deepEqual(bindings(source), ['x@6 -> [41]', 'x@21 -> [31]']);
  });

  it('treats only the first name of a function path as a variable', () => {
    const analysis = analyze('local M = {} function M.a.b() end function g() end');
    assert.deepEqual(analysis.declarations.map((d) => [d.name, d.references.length]), [['M', 1]]);
    assert.deepEqual([...analysis.globals.keys()], ['g']);
  });

  it('maps declaring identifiers to their own declaration', () => {
    const chunk = parseChunk('local a, b = 1');
    const analysis = analyzeScopes(chunk);
    const [statement] = chunk.body.body;
    assert.ok(statement?.kind === 'LocalStatement');
    for (const name of statement.names) {
      assert.equal(analysis.resolved.get(name)?.identifier, name);
    }
  });

  it('ignores field names in table constructors and member accesses', () => {
    assert.deepEqual(globalNames('t = { name = value, [key] = 1 } u = t.name'), ['t', 'value', 'key', 'u']);
  });

  it('records assignment targets and `function x()` names as writes', () => {
    //            0         1         2         3         4
    //            0123456789012345678901234567890123456789012345678
    const source = 'local a a, t.f, b = 1 function g() end a = b + g';
    const writes = [...analyze(source).writes].map((identifier) => `${identifier.name}@${String(identifier.start)}`);
    assert.deepEqual(writes, ['a@8', 'b@16', 'g@31', 'a@39']);
  });

  describe('environmentFields', () => {
    const fields = (source: string): string[] => [...analyze(source).environmentFields].map((identifier) => `${identifier.name}@${String(identifier.start)}`);

    it('is empty while only the chunk\'s own _ENV is in effect', () => {
      assert.deepEqual(fields('print(x) _ENV.y = 1'), []);
    });

    it('records globals resolved while a local _ENV is visible, and only then', () => {
      //            0         1         2         3
      //            0123456789012345678901234567890123456789
      const source = 'a = 1 do local _ENV = {} b = c end d()';
      assert.deepEqual(fields(source), ['b@25', 'c@29']);
      // They stay globals by name, as navigation expects.
      assert.deepEqual(globalNames(source), ['a', 'b', 'c', 'd']);
    });

    it('treats a parameter or for variable named _ENV the same way', () => {
      assert.deepEqual(fields('function f(_ENV) return x end'), ['x@24']);
      assert.deepEqual(fields('for _ENV in e do y() end'), ['y@17']);
    });

    it('applies `local _ENV = _ENV` only after the statement', () => {
      //            0         1         2
      //            0123456789012345678901234
      const source = 'local _ENV = x return y';
      assert.deepEqual(fields(source), ['y@22']);
    });
  });

  it('does not record declarations, reads or function paths with fields or methods as writes', () => {
    assert.deepEqual([...analyze('local x = y function t.f() end function t:m() end print(x)').writes], []);
  });

  describe('visibility', () => {
    /**
     * Names visible where `|` is in `marked` (the marker is removed before parsing,
     * which may leave the code incomplete), sorted, as `name:kind@declaringOffset`.
     */
    function visible(marked: string): string[] {
      const offset = marked.indexOf('|');
      assert.ok(offset >= 0 && marked.indexOf('|', offset + 1) < 0, 'exactly one marker');
      const source = marked.slice(0, offset) + marked.slice(offset + 1);
      return visibleAt(analyzeScopes(parseChunk(source)), offset)
        .map((d) => `${d.name}:${d.kind}@${d.identifier ? String(d.identifier.start) : '-'}`)
        .sort();
    }

    it('makes a local visible after its statement, not in its own initializer', () => {
      assert.deepEqual(visible('local x = 1 |'), ['x:local@6']);
      assert.deepEqual(visible('local x = |'), []);
      assert.deepEqual(visible('local x = y|'), []);
      assert.deepEqual(visible('local x = 1 local y = x|'), ['x:local@6']);
    });

    it('makes a local function visible in its own body', () => {
      assert.deepEqual(visible('local function f() | end'), ['f:localFunction@15']);
    });

    it('makes parameters and the implicit self visible in the body only', () => {
      assert.deepEqual(visible('function t:m(a) | end'), ['a:parameter@13', 'self:self@-']);
      assert.deepEqual(visible('function t:m(a) end |'), []);
    });

    it('makes for variables visible in the loop body, not in the loop expressions', () => {
      assert.deepEqual(visible('for i = 1, 2 do | end'), ['i:forVariable@4']);
      assert.deepEqual(visible('for i = 1, n| do end'), []);
      assert.deepEqual(visible('for k, v in pairs(t) do | end'), ['k:forVariable@4', 'v:forVariable@7']);
      assert.deepEqual(visible('for k, v in pairs(t) do end |'), []);
    });

    it('ends block scopes at their closing keyword, and lets until see the repeat body', () => {
      assert.deepEqual(visible('do local x = 1 | end'), ['x:local@9']);
      assert.deepEqual(visible('do local x = 1 end |'), []);
      assert.deepEqual(visible('while c do local x = 1 | end'), ['x:local@17']);
      assert.deepEqual(visible('repeat local x = 1 until x|'), ['x:local@13']);
      assert.deepEqual(visible('repeat local x = 1 until x |'), []);
      assert.deepEqual(visible('if a then local x = 1 | else end'), ['x:local@16']);
      assert.deepEqual(visible('if a then local x = 1 else | end'), []);
      assert.deepEqual(visible('if a then local x = 1 elseif | then end'), []);
    });

    it('keeps the innermost declaration of each name', () => {
      assert.deepEqual(visible('local x = 1 do local x = 2 | end'), ['x:local@21']);
      assert.deepEqual(visible('local x = 1 do local x = 2 end |'), ['x:local@6']);
      assert.deepEqual(visible('local x = 1 local x = 2 |'), ['x:local@18']);
      assert.deepEqual(visible('local a = 1 function f(a) | end'), ['a:parameter@23']);
    });

    it('sees through code that does not parse, up to the closing keyword', () => {
      assert.deepEqual(visible('local function f(a)\n  local b = 1\n  a.|\nend'), ['a:parameter@17', 'b:local@28', 'f:localFunction@15']);
      assert.deepEqual(visible('local function f(a)\n  local b = 1\n  print(|\nend'), ['a:parameter@17', 'b:local@28', 'f:localFunction@15']);
      assert.deepEqual(visible('local function f(a)\n  local b = 1\nend\nprint(|'), ['f:localFunction@15']);
    });

    it('extends scopes without a closing keyword to the end of the enclosing scope', () => {
      assert.deepEqual(visible('local function f(a)\n  local b = 1\n  |'), ['a:parameter@17', 'b:local@28', 'f:localFunction@15']);
      assert.deepEqual(visible('do\n  for i = 1, 2 do\n    local x = i\nend\n|'), []);
    });
  });
});
