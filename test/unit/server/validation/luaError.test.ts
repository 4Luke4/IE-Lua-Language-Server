import assert from 'node:assert/strict';
import { parseLuaError } from '../../../../src/server/validation/luaError.ts';

describe('server/validation/luaError', () => {
  it('parses a message with a quoted near token', () => {
    assert.deepEqual(parseLuaError("chunk:3: '=' expected near 'y'", 'lua52'), {
      line: 3,
      message: "'=' expected near 'y'",
      nearToken: 'y',
      atEof: false,
    });
  });

  it('parses a message ending at <eof>', () => {
    assert.deepEqual(parseLuaError("chunk:7: 'end' expected (to close 'function' at line 1) near <eof>", 'lua52'), {
      line: 7,
      message: "'end' expected (to close 'function' at line 1) near <eof>",
      atEof: true,
    });
  });

  it('keeps quotes inside the near token', () => {
    assert.equal(parseLuaError("chunk:1: unfinished string near '\"abc'", 'lua52')?.nearToken, '"abc');
  });

  it('parses a message without a near clause', () => {
    assert.deepEqual(parseLuaError('chunk:2: chunk has too many syntax levels', 'lua52'), {
      line: 2,
      message: 'chunk has too many syntax levels',
      atEof: false,
    });
  });

  it('reads an unquoted <eof> as a token for LuaJIT, and a quoted one as a token for Lua 5.2', () => {
    // Each front end names the end of the chunk one way only; the other spelling is not theirs.
    assert.equal(parseLuaError("chunk:1: unexpected symbol near '<eof>'", 'lua52')?.atEof, false);
    assert.equal(parseLuaError('chunk:1: unexpected symbol near <eof>', 'luajit')?.atEof, false);
  });

  it("parses LuaJIT's quoted <eof>", () => {
    assert.deepEqual(parseLuaError("chunk:2: 'end' expected near '<eof>'", 'luajit'), {
      line: 2,
      message: "'end' expected near '<eof>'",
      atEof: true,
    });
  });

  it('parses a LuaJIT message with a near token', () => {
    assert.deepEqual(parseLuaError("chunk:1: malformed number near '1LLL'", 'luajit'), {
      line: 1,
      message: "malformed number near '1LLL'",
      nearToken: '1LLL',
      atEof: false,
    });
  });

  it('rejects other shapes', () => {
    assert.equal(parseLuaError('not enough memory', 'lua52'), undefined);
    assert.equal(parseLuaError('other:1: message', 'lua52'), undefined);
    assert.equal(parseLuaError('other:1: message', 'luajit'), undefined);
  });
});
