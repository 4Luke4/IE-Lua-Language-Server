import assert from 'node:assert/strict';
import { menuKeyword, MENU_KEYWORDS } from '../../../../src/server/validation/menuKeywords.ts';
import { lexMenu } from '../../../../src/server/validation/menuLexer.ts';

/** `type:value` per token, where value is the token's value text. */
function tokens(text: string): string[] {
  return lexMenu(text).tokens.map((t) => `${t.keyword === undefined ? t.type : `kw`}:${text.slice(t.valueStart, t.valueEnd)}`);
}

describe('server/validation/menuKeywords', () => {
  it('has the 122 distinct keywords of the engine table', () => {
    assert.equal(MENU_KEYWORDS.length, 122);
    assert.equal(new Set(MENU_KEYWORDS.map((k) => k.toLowerCase())).size, 122);
  });

  it('matches keywords case-insensitively and returns them in lower case', () => {
    assert.equal(menuKeyword('ActionUpdate'), 'actionupdate');
    assert.equal(menuKeyword('MENU'), 'menu');
    assert.equal(menuKeyword('characterDetails'), undefined);
  });
});

describe('server/validation/menuLexer', () => {
  it('reads keywords, words, numbers and braces', () => {
    assert.deepEqual(tokens('menu { name MAIN area 0 10 -5 }'), [
      'kw:menu', '{:{', 'kw:name', 'string:MAIN', 'kw:area', 'number:0', 'number:10', '-:-', 'number:5', '}:}',
    ]);
  });

  it('treats both quote characters alike, with no escapes, across lines', () => {
    assert.deepEqual(tokens(`"it's" 'say "hi"' "a\\" 'x\ny'`), [
      "string:it's", 'string:say "hi"', 'string:a\\', 'string:x\ny',
    ]);
    const [quoted, word] = lexMenu(`'q' w`).tokens;
    assert.equal(quoted?.quote, "'");
    assert.equal(word?.quote, undefined);
  });

  it('splits words at characters that are not ASCII letters or digits, such as "_"', () => {
    assert.deepEqual(tokens('My_Menu a.b 1x'), ['string:My', 'kw:Menu', 'string:a', 'string:b', 'number:1', 'string:x']);
  });

  it('skips punctuation, so commas between values are ignored', () => {
    assert.deepEqual(tokens('area 0, 0, 10, 10;'), ['kw:area', 'number:0', 'number:0', 'number:10', 'number:10']);
  });

  it('skips -- comments to the end of the line, but keeps a single minus', () => {
    assert.deepEqual(tokens('a -- "b\n- 1 --c\r\nd'), ['string:a', '-:-', 'number:1', 'string:d']);
  });

  it('records inline Lua without producing a token', () => {
    const text = 'action `x = 1\n` "f()"';
    const { tokens: found, inline } = lexMenu(text);
    assert.deepEqual(found.map((t) => t.keyword ?? text.slice(t.valueStart, t.valueEnd)), ['action', 'f()']);
    assert.deepEqual(inline, [{ start: 7, close: 14 }]);
  });

  it('does not start inline Lua inside strings or comments', () => {
    assert.deepEqual(lexMenu('"`" -- `\n\'`\'').inline, []);
  });

  it('runs an unterminated string to the end of the file and reports it', () => {
    const text = "a 'b\nc";
    const { tokens: found, problems } = lexMenu(text);
    assert.equal(found.at(-1)?.end, text.length);
    assert.deepEqual(problems.map((p) => [p.code, p.start, p.message]), [
      ['menu-unterminated-string', 2, 'Unterminated string: missing closing "\'".'],
    ]);
  });

  it('reports an unterminated inline Lua block and stops', () => {
    const { tokens: found, problems } = lexMenu('a `b c');
    assert.equal(found.length, 1);
    assert.deepEqual(problems.map((p) => [p.code, p.start, p.end]), [['menu-unterminated-block', 2, 3]]);
  });
});
