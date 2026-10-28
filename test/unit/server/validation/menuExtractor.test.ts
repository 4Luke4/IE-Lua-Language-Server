import assert from 'node:assert/strict';
import { extractMenuLua } from '../../../../src/server/validation/menuExtractor.ts';

/** Returns [kind, text] pairs and checks every chunk's offset points at its text. */
function chunksOf(menu: string): [string, string][] {
  const { chunks } = extractMenuLua(menu);
  for (const chunk of chunks) {
    assert.equal(menu.slice(chunk.offset, chunk.offset + chunk.text.length), chunk.text);
  }
  return chunks.map((chunk) => [chunk.kind, chunk.text]);
}

describe('server/validation/menuExtractor', () => {
  it('extracts top-level backtick blocks as statements', () => {
    assert.deepEqual(chunksOf('`\nlocal x = 1\n`\nmenu\n{\n}\n`y = 2`'), [
      ['statements', '\nlocal x = 1\n'],
      ['statements', 'y = 2'],
    ]);
  });

  it('extracts `lua "…"` values as expressions, whatever the property', () => {
    assert.deepEqual(chunksOf('label\n{\n\ttext lua "getName()"\n\tclickable lua "a and b"\n}'), [
      ['expression', 'getName()'],
      ['expression', 'a and b'],
    ]);
  });

  it('extracts action scripts on the same line and on the next line', () => {
    assert.deepEqual(chunksOf('button\n{\n\taction "Close()"\n\tonOpen\n\t"\n\t\tx = 1\n\t"\n}'), [
      ['statements', 'Close()'],
      ['statements', '\n\t\tx = 1\n\t'],
    ]);
  });

  it('matches property names case-insensitively', () => {
    assert.deepEqual(chunksOf('ONOPEN "a()"\nonclose "b()"\nActionAlt "c()"'), [
      ['statements', 'a()'],
      ['statements', 'b()'],
      ['statements', 'c()'],
    ]);
  });

  it('extracts `enabled "…"` as an expression', () => {
    assert.deepEqual(chunksOf('enabled "mode == 1" -- trailing comment'), [['expression', 'mode == 1']]);
  });

  it('ignores menu strings that are not Lua', () => {
    assert.deepEqual(chunksOf("name 'MAIN'\ntext \"TITLE_KEY\"\ntext style \"title\"\nvar \"someVar\"\nmosaic 'GUI'"), []);
  });

  it('does not take a property from a line that already ended with a string', () => {
    assert.deepEqual(chunksOf('action "a()"\n"b()"'), [['statements', 'a()']]);
  });

  it('skips menu-level -- comments, including quotes inside them', () => {
    assert.deepEqual(chunksOf('-- action "not lua\naction "real()"'), [['statements', 'real()']]);
  });

  it('keeps CRLF line endings inside chunks', () => {
    assert.deepEqual(chunksOf('action\r\n"\r\n\tx()\r\n"'), [['statements', '\r\n\tx()\r\n']]);
  });

  it('reports an unterminated backtick block', () => {
    const { chunks, problems } = extractMenuLua('menu\n{\n}\n`\nlocal x = 1\n');
    assert.deepEqual(chunks, []);
    assert.deepEqual(problems.map((p) => [p.code, p.start, p.end]), [['menu-unterminated-block', 9, 10]]);
  });

  it('reports an unterminated double-quoted string', () => {
    const { problems } = extractMenuLua('action "x()');
    assert.deepEqual(problems.map((p) => [p.code, p.start]), [['menu-unterminated-string', 7]]);
  });
});
