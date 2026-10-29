import assert from 'node:assert/strict';
import { parseDocument } from '../../../../src/server/syntax/document.ts';
import { memberAt, memberIndex } from '../../../../src/server/syntax/members.ts';

describe('server/syntax/members', () => {
  //            0         1         2         3
  //            0123456789012345678901234567890123456
  const text = 'string.format(s:rep(2)) function t.f() end';
  const document = parseDocument(text, 'lua');

  it('lists field and method names used in expressions, in source order', () => {
    assert.deepEqual(
      memberIndex(document).map(({ identifier, node }) => `${identifier.name}@${String(identifier.start)}:${node.kind}`),
      ['format@7:MemberExpression', 'rep@16:MethodCallExpression'],
    );
  });

  it('finds the name under the cursor, also just after it, but not the base', () => {
    assert.equal(memberAt(document, 7)?.identifier.name, 'format');
    assert.equal(memberAt(document, 13)?.identifier.name, 'format');
    assert.equal(memberAt(document, 16)?.identifier.name, 'rep');
    assert.equal(memberAt(document, 3), undefined);
    // `f` in `function t.f()` names a field being defined.
    assert.equal(memberAt(document, 35), undefined);
  });

  it('records the chunk of each name in a .menu file', () => {
    const menu = parseDocument('menu { onOpen "a.b()" } menu { onOpen "c.d()" }', 'menu');
    assert.deepEqual(memberIndex(menu).map(({ identifier, chunkIndex }) => `${identifier.name}:${String(chunkIndex)}`), ['b:0', 'd:1']);
  });
});
