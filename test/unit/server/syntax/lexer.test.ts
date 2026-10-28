import assert from 'node:assert/strict';
import { KEYWORDS, lex } from '../../../../src/server/syntax/lexer.ts';

/** [type, value] of every token except the final `eof`. */
function tokens(source: string): [string, string][] {
  const result = lex(source);
  assert.equal(result.tokens.at(-1)?.type, 'eof');
  return result.tokens.slice(0, -1).map((token) => [token.type, token.value]);
}

function errors(source: string): string[] {
  return lex(source).errors.map((error) => error.message);
}

describe('server/syntax/lexer', () => {
  it('knows exactly the 22 reserved words of Lua 5.2', () => {
    assert.equal(KEYWORDS.size, 22);
    assert.ok(KEYWORDS.has('goto'));
    assert.deepEqual(tokens('goto continue self'), [['keyword', 'goto'], ['name', 'continue'], ['name', 'self']]);
  });

  it('reads names as ASCII letters, digits and underscores only', () => {
    assert.deepEqual(tokens('_a1 b_2'), [['name', '_a1'], ['name', 'b_2']]);
    assert.deepEqual(tokens('é'), [['symbol', 'é']]);
  });

  it('reads multi-character symbols greedily', () => {
    assert.deepEqual(
      tokens('... .. . == = ~= ~ <= < >= > ::').map(([, value]) => value),
      ['...', '..', '.', '==', '=', '~=', '~', '<=', '<', '>=', '>', '::'],
    );
  });

  it('accepts the numerals of Lua 5.2, including hexadecimal fractions and exponents', () => {
    for (const numeral of ['3', '3.', '.5', '3.0e-2', '1E+5', '0xff', '0XA.8p1', '0x.1P-2', '0x1p4']) {
      assert.deepEqual(tokens(numeral), [['number', numeral]], numeral);
      assert.deepEqual(errors(numeral), [], numeral);
    }
  });

  it('reads malformed numerals as one token, like read_numeral, and reports them', () => {
    for (const numeral of ['12abc', '3..2', '1e', '0x', '0x.p1', '1e+']) {
      assert.deepEqual(tokens(numeral), [['number', numeral]], numeral);
      assert.deepEqual(errors(numeral), ['malformed number'], numeral);
    }
  });

  it('reads short strings with every Lua 5.2 escape sequence', () => {
    const source = String.raw`'\a\b\f\n\r\t\v\\\"\'\x41\65\z   ' "\
"`;
    assert.deepEqual(tokens(source).map(([type]) => type), ['string', 'string']);
    assert.deepEqual(errors(source), []);
  });

  it('reports invalid escapes and unfinished strings', () => {
    assert.deepEqual(errors(String.raw`'\q'`), ['invalid escape sequence']);
    assert.deepEqual(errors(String.raw`'\x4'`), ['hexadecimal digit expected']);
    assert.deepEqual(errors(String.raw`'\256'`), ['decimal escape too large']);
    assert.deepEqual(errors("'abc\nx'"), ['unfinished string', 'unfinished string']);
  });

  it('matches long brackets of the same level only', () => {
    assert.deepEqual(tokens('[==[ a ]=] ]] ]==] x'), [['string', '[==[ a ]=] ]] ]==]'], ['name', 'x']]);
    assert.deepEqual(errors('[=[ never closed'), ['unfinished long string']);
    assert.deepEqual(errors('x = [=a'), ['invalid long string delimiter']);
    assert.deepEqual(tokens('t[1]'), [['name', 't'], ['symbol', '['], ['number', '1'], ['symbol', ']']]);
  });

  it('keeps comments apart from tokens and tells short from long ones', () => {
    const source = '--[[ long\ncomment ]] x -- short\n--[==x is short\ny';
    const result = lex(source);
    assert.deepEqual(result.tokens.slice(0, -1).map((token) => token.value), ['x', 'y']);
    assert.deepEqual(
      result.comments.map((comment) => [source.slice(comment.start, comment.end), comment.long]),
      [['--[[ long\ncomment ]]', true], ['-- short', false], ['--[==x is short', false]],
    );
    assert.deepEqual(errors('--[[ unterminated'), ['unfinished long comment']);
  });

  it('lexes only the requested slice and reports document offsets', () => {
    const source = 'menu `x = 1` end';
    const result = lex(source, 6, 11);
    assert.deepEqual(result.tokens.map((token) => [token.value, token.start, token.end]), [
      ['x', 6, 7],
      ['=', 8, 9],
      ['1', 10, 11],
      ['<eof>', 11, 11],
    ]);
  });

  it('never skips a leading #! line (luaL_loadbuffer does not)', () => {
    assert.deepEqual(tokens('#!lua').slice(0, 2), [['symbol', '#'], ['symbol', '!']]);
  });
});
