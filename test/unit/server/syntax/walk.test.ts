import assert from 'node:assert/strict';
import { parseChunk } from '../../../../src/server/syntax/parser.ts';
import { walk } from '../../../../src/server/syntax/walk.ts';

function kinds(source: string): string[] {
  const chunk = parseChunk(source);
  assert.deepEqual(chunk.errors, [], source);
  const visited: string[] = [];
  walk(chunk.body, (node) => visited.push(node.kind === 'Identifier' ? `Identifier:${node.name}` : node.kind));
  return visited;
}

describe('server/syntax/walk', () => {
  it('visits statements and expressions in source order, parents first', () => {
    assert.deepEqual(kinds('local x = a.b(1) x = -x'), [
      'LocalStatement', 'CallExpression', 'MemberExpression', 'Identifier:a', 'NumberLiteral',
      'AssignmentStatement', 'Identifier:x', 'UnaryExpression', 'Identifier:x',
    ]);
  });

  it('enters function bodies, table constructors and every kind of block', () => {
    const visited = kinds(
      'function f() return { k = g, [h] = 1, i } end local function l() end ' +
        'do j() end while w do end repeat until u if c then elseif d then else end ' +
        'for n = s, e, p do end for k in it do end',
    );
    for (const name of ['g', 'h', 'i', 'j', 'w', 'u', 'c', 'd', 's', 'e', 'p', 'it']) {
      assert.ok(visited.includes(`Identifier:${name}`), name);
    }
    // Declared names, parameters and field names are not expressions.
    for (const name of ['f', 'l', 'n', 'k']) {
      assert.equal(visited.includes(`Identifier:${name}`), false, name);
    }
  });
});
