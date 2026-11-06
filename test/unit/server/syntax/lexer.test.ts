import assert from 'node:assert/strict';
import { isLuaJitNumber, KEYWORDS, lex } from '../../../../src/server/syntax/lexer.ts';
import type { Runtime } from '../../../../src/shared/settings.ts';

/** [type, value] of every token except the final `eof`. */
function tokens(source: string, runtime: Runtime = 'lua52'): [string, string][] {
  const result = lex(source, 0, source.length, runtime);
  assert.equal(result.tokens.at(-1)?.type, 'eof');
  return result.tokens.slice(0, -1).map((token) => [token.type, token.value]);
}

function errors(source: string, runtime: Runtime = 'lua52'): string[] {
  return lex(source, 0, source.length, runtime).errors.map((error) => error.message);
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

  describe('with the LuaJIT runtime', () => {
    it('accepts 64-bit integer, imaginary and binary literals as one number token', () => {
      for (const numeral of ['1LL', '1ll', '0x10ULL', '0x10uLl', '7LLU', '18446744073709551615ULL', '3i', '2.5I', '1e3i', '0x1p4i', '0b1011', '0B1i', '0b1LL', '.5i', '1.i']) {
        assert.deepEqual(tokens(numeral, 'luajit'), [['number', numeral]], numeral);
        assert.deepEqual(errors(numeral, 'luajit'), [], numeral);
      }
    });

    it('still accepts every Lua 5.2 numeral', () => {
      for (const numeral of ['3', '3.', '.5', '3.0', '0xff', '0x.8', '0xA.p1', '1e+5', '0x1Fp-2', '5E2']) {
        assert.deepEqual(tokens(numeral, 'luajit'), [['number', numeral]], numeral);
        assert.deepEqual(errors(numeral, 'luajit'), [], numeral);
      }
    });

    it('reads a numeral as lex_number does: every identifier character, then reports a malformed one', () => {
      assert.deepEqual(tokens('1LLL + x', 'luajit'), [['number', '1LLL'], ['symbol', '+'], ['name', 'x']]);
      assert.deepEqual(errors('1LLL', 'luajit'), ['malformed number']);
      assert.deepEqual(tokens('1g', 'luajit'), [['number', '1g']]);
      // `+` and `-` belong to the numeral only after its exponent letter.
      assert.deepEqual(tokens('0xe+1', 'luajit'), [['number', '0xe'], ['symbol', '+'], ['number', '1']]);
      assert.deepEqual(tokens('1e-2', 'luajit'), [['number', '1e-2']]);
      assert.deepEqual(tokens('1é', 'luajit'), [['number', '1é']]);
    });

    it('refuses what lj_strscan.c refuses', () => {
      for (const numeral of [
        '1.5LL', '1e5LL', '1L', '1U', '1UL', '1ULLU', '1LLi', '1iLL', '1ii', '0x', '0b', '0b2', '0b1.0', '0b1p1', '0b1e1', '1e', '1e+', '0x1p',
        '18446744073709551616ULL', '0x10000000000000000LL', `0b${'1'.repeat(65)}`, '1e1048576', '1é', '1..2',
      ]) {
        assert.deepEqual(errors(numeral, 'luajit'), ['malformed number'], numeral);
      }
    });

    it('applies the 64-bit and exponent limits exactly', () => {
      assert.equal(isLuaJitNumber('0x0000000000000000FFFFFFFFFFFFFFFFULL'), true);
      assert.equal(isLuaJitNumber('000018446744073709551615LL'), true);
      assert.equal(isLuaJitNumber(`0b0${'1'.repeat(64)}`), true);
      assert.equal(isLuaJitNumber(`0b${'1'.repeat(65)}i`), false);
      assert.equal(isLuaJitNumber(`0x${'f'.repeat(40)}`), true);
      assert.equal(isLuaJitNumber('1e1048575'), true);
      assert.equal(isLuaJitNumber('1e01048575'), true);
      assert.equal(isLuaJitNumber(`0.${'1'.repeat(1048575)}`), true);
      assert.equal(isLuaJitNumber(`0.${'1'.repeat(1048576)}`), false);
      assert.equal(isLuaJitNumber(`1.${'0'.repeat(1048576)}`), true);
    });

    it('accepts \\u{XXXX} escapes up to U+10FFFF, without surrogates', () => {
      for (const string of ['"\\u{48}"', '"\\u{20AC}"', '"\\u{10FFFF}"', '"\\u{0000000041}"', "'\\u{d7ff}\\u{E000}'"]) {
        assert.deepEqual(tokens(string, 'luajit'), [['string', string]], string);
        assert.deepEqual(errors(string, 'luajit'), [], string);
      }
      for (const string of ['"\\u{110000}"', '"\\u{D800}"', '"\\u{DFFF}"', '"\\u{}"', '"\\u48"', '"\\u{4G}"', '"\\u{48"']) {
        assert.deepEqual(errors(string, 'luajit'), ['invalid escape sequence'], string);
      }
    });

    it('keeps the other rules of Lua 5.2', () => {
      assert.deepEqual(errors('"\\q"', 'luajit'), ['invalid escape sequence']);
      assert.deepEqual(errors('"\\x4"', 'luajit'), ['hexadecimal digit expected']);
      assert.deepEqual(tokens('é', 'luajit'), [['symbol', 'é']]);
      assert.deepEqual(tokens('a // b', 'luajit').map(([, value]) => value), ['a', '/', '/', 'b']);
    });

    it('is off for Lua 5.2, which reads the same text as before', () => {
      assert.deepEqual(tokens('1LL'), [['number', '1'], ['name', 'LL']]);
      assert.deepEqual(errors('0b1'), ['malformed number']);
      assert.deepEqual(tokens('3i'), [['number', '3'], ['name', 'i']]);
      assert.deepEqual(errors('"\\u{48}"'), ['invalid escape sequence']);
    });
  });
});
