import assert from 'node:assert/strict';
import { extractMenuLua, type MenuBlock } from '../../../../src/server/validation/menuExtractor.ts';

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

  describe('blocks', () => {
    /** keyword(name)[children] per block; `!` marks a block that is never closed. */
    function outline(blocks: readonly MenuBlock[]): string {
      return blocks
        .map((b) => `${b.keyword?.text ?? '?'}${b.name ? `(${b.name.text})` : ''}${b.close === undefined ? '!' : ''}${b.children.length > 0 ? `[${outline(b.children)}]` : ''}`)
        .join(' ');
    }

    it('records nested blocks with their keyword, on the same line or the line before', () => {
      const menu = "menu\n{\n\tname 'MAIN'\n\tbutton {\n\t\taction \"f()\"\n\t}\n\tlabel\n\t{\n\t}\n}\nmenu\n{\n}\n";
      assert.equal(outline(extractMenuLua(menu).blocks), 'menu(MAIN)[button label] menu');
    });

    it('records the offsets of the keyword, the braces and the name', () => {
      const menu = 'menu\n{\n\tname "M"\n}';
      const [block] = extractMenuLua(menu).blocks;
      assert.ok(block?.keyword && block.name && block.close !== undefined);
      assert.equal(menu.slice(block.keyword.start, block.keyword.end), 'menu');
      assert.equal(menu[block.open], '{');
      assert.equal(menu[block.close], '}');
      assert.equal(menu.slice(block.name.start, block.name.end), 'M');
    });

    it('takes only a name property directly inside the block, and only the first one', () => {
      const menu = "menu\n{\n\tbutton\n\t{\n\t\tname 'B'\n\t}\n\tname 'M'\n\tname 'IGNORED'\n}";
      assert.equal(outline(extractMenuLua(menu).blocks), 'menu(M)[button(B)]');
    });

    it('ignores braces inside strings, comments and Lua blocks', () => {
      const menu = "menu\n{\n\ttext \"{\"\n\t-- }\n\taction \"t = {}\"\n}\n`x = {}`";
      assert.equal(outline(extractMenuLua(menu).blocks), 'menu');
    });

    it('leaves unclosed blocks open and ignores unmatched closing braces', () => {
      assert.equal(outline(extractMenuLua('}\nmenu\n{\n\tbutton\n\t{\n').blocks), 'menu![button!]');
    });
  });

  it('tells backtick blocks from property values', () => {
    assert.deepEqual(extractMenuLua('`a()`\naction "b()"').chunks.map((c) => c.origin), ['block', 'property']);
  });
});
