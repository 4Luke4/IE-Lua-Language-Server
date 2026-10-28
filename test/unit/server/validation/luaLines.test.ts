import assert from 'node:assert/strict';
import { luaLineRanges } from '../../../../src/server/validation/luaLines.ts';

describe('server/validation/luaLines', () => {
  it('returns one empty line for empty text', () => {
    assert.deepEqual(luaLineRanges(''), [{ start: 0, end: 0 }]);
  });

  it('treats \\n, \\r, \\r\\n and \\n\\r each as a single line break, like llex.c', () => {
    const lines = luaLineRanges('a\nb\rc\r\nd\n\re');
    assert.deepEqual(
      lines.map(({ start, end }) => 'a\nb\rc\r\nd\n\re'.slice(start, end)),
      ['a', 'b', 'c', 'd', 'e'],
    );
  });

  it('counts consecutive identical breaks as separate lines', () => {
    assert.equal(luaLineRanges('a\n\nb').length, 3);
    assert.equal(luaLineRanges('a\r\rb').length, 3);
  });

  it('keeps a trailing empty line after a final break', () => {
    assert.deepEqual(luaLineRanges('x\n'), [
      { start: 0, end: 1 },
      { start: 2, end: 2 },
    ]);
  });
});
