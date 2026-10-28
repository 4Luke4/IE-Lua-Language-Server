import assert from 'node:assert/strict';
import { parseLuaError } from '../../../../src/server/validation/luaError.ts';

describe('server/validation/luaError', () => {
  it('parses a message with a quoted near token', () => {
    assert.deepEqual(parseLuaError("chunk:3: '=' expected near 'y'"), {
      line: 3,
      message: "'=' expected near 'y'",
      nearToken: 'y',
      atEof: false,
    });
  });

  it('parses a message ending at <eof>', () => {
    assert.deepEqual(parseLuaError("chunk:7: 'end' expected (to close 'function' at line 1) near <eof>"), {
      line: 7,
      message: "'end' expected (to close 'function' at line 1) near <eof>",
      atEof: true,
    });
  });

  it('keeps quotes inside the near token', () => {
    assert.equal(parseLuaError("chunk:1: unfinished string near '\"abc'")?.nearToken, '"abc');
  });

  it('parses a message without a near clause', () => {
    assert.deepEqual(parseLuaError('chunk:2: chunk has too many syntax levels'), {
      line: 2,
      message: 'chunk has too many syntax levels',
      atEof: false,
    });
  });

  it('rejects other shapes', () => {
    assert.equal(parseLuaError('not enough memory'), undefined);
    assert.equal(parseLuaError('other:1: message'), undefined);
  });
});
