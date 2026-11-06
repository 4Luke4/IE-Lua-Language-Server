import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyEdits, type FormattingOptions } from '../../../../src/server/formatting/format.ts';
import {
  formatMenuDocument,
  formatMenuOnType,
  formatMenuRange,
  type MenuFormatResult,
} from '../../../../src/server/formatting/menuFormat.ts';
import { parseDocument } from '../../../../src/server/syntax/document.ts';
import { lexMenu } from '../../../../src/server/validation/menuLexer.ts';

const SPACES: FormattingOptions = { tabSize: 2, insertSpaces: true };

function edited(text: string, result: MenuFormatResult): string {
  assert.ok(result.ok, `formatting was refused: ${result.ok ? '' : result.reason}`);
  for (let i = 1; i < result.edits.length; i++) {
    assert.ok((result.edits[i]?.start ?? 0) >= (result.edits[i - 1]?.end ?? 0), 'edits are disjoint and in order');
  }
  return applyEdits(text, result.edits);
}

/** Formats a whole document given as lines joined with `\n`. */
function format(lines: readonly string[], options: FormattingOptions = SPACES): string[] {
  const text = lines.join('\n');
  return edited(text, formatMenuDocument(parseDocument(text, 'menu'), options)).split('\n');
}

describe('server/formatting/menuFormat', () => {
  describe('menu structure', () => {
    it('indents each line by the blocks open at its start', () => {
      assert.deepEqual(format(['menu', '{', 'name "m"', '    label', '{', 'text "t"', '}', '}']), [
        'menu',
        '{',
        '  name "m"',
        '  label',
        '  {',
        '    text "t"',
        '  }',
        '}',
      ]);
    });

    it('indents a line that starts with `}` like the line that opened the block', () => {
      assert.deepEqual(format(['menu {', 'button {', 'text "t" } }', 'x']), ['menu {', '  button {', '    text "t" } }', 'x']);
      assert.deepEqual(format(['menu {', 'button {', 'text "t"', '} }']), ['menu {', '  button {', '    text "t"', '} }']);
    });

    it('indents with tabs when asked to', () => {
      assert.deepEqual(format(['menu {', 'name "m"', '}'], { tabSize: 4, insertSpaces: false }), ['menu {', '\tname "m"', '}']);
    });

    it('removes trailing white space and empties blank lines', () => {
      assert.deepEqual(format(['menu {  ', '   ', 'name "m"\t', '} -- done  ']), ['menu {', '', '  name "m"', '} -- done']);
    });

    it('keeps the spacing within a line', () => {
      assert.deepEqual(format(['menu {', 'area   0 0   10 10', '}']), ['menu {', '  area   0 0   10 10', '}']);
    });

    it('keeps the lines of a string that is not Lua exactly as written', () => {
      assert.deepEqual(format(['menu {', 'text "one  ', '      two"', '}']), ['menu {', '  text "one  ', '      two"', '}']);
    });

    it('counts no braces inside strings, comments or Lua', () => {
      assert.deepEqual(format(['menu {', 'text "{"', '-- {', '`t = {`', 'name "m"', '}']), [
        'menu {',
        '  text "{"',
        '  -- {',
        '  `t = {`',
        '  name "m"',
        '}',
      ]);
    });

    it('never indents below level 0 after a `}` too many', () => {
      assert.deepEqual(format(['}', '  name "m"']), ['}', 'name "m"']);
    });

    it('keeps CRLF line breaks', () => {
      const text = 'menu {\r\nname "m"  \r\n}\r\n';
      assert.equal(edited(text, formatMenuDocument(parseDocument(text, 'menu'), SPACES)), 'menu {\r\n  name "m"\r\n}\r\n');
    });
  });

  describe('embedded Lua', () => {
    it('formats the Lua of a property, one level deeper than the property', () => {
      assert.deepEqual(format(['menu {', 'onOpen "', 'if x then', 'y()', 'end', '"', '}']), [
        'menu {',
        '  onOpen "',
        '    if x then',
        '      y()',
        '    end',
        '  "',
        '}',
      ]);
    });

    it('formats the Lua of a quote on its own line one level deeper than the quote', () => {
      assert.deepEqual(format(['menu {', 'action', '"', 'f()', '"', '}']), ['menu {', '  action', '  "', '    f()', '  "', '}']);
    });

    it('keeps the Lua of a `` ` `` block outside any menu block at level 0, as in a Lua file', () => {
      assert.deepEqual(format(['`', 'function f( a )', 'return a', 'end', '`']), ['`', 'function f(a)', '  return a', 'end', '`']);
      assert.deepEqual(format(['menu {', '`', 'x=1', '`', '}']), ['menu {', '  `', '    x = 1', '  `', '}']);
    });

    it('applies the Lua spacing to Lua on one line, but not to strings that are not Lua', () => {
      assert.deepEqual(format(['menu {', 'enabled "a==b"', 'text "a==b"', 'action `f( 1 ) `', '}']), [
        'menu {',
        '  enabled "a == b"',
        '  text "a==b"',
        '  action `f(1) `',
        '}',
      ]);
    });

    it('keeps the white space on the lines of the opening and closing delimiters around the Lua', () => {
      assert.deepEqual(format(['menu {', 'action "   f()', 'g()   "', '}']), ['menu {', '  action "   f()', '    g()   "', '}']);
    });

    it('removes trailing white space inside the Lua', () => {
      assert.deepEqual(format(['menu {', 'action "  ', 'f()  ', '"', '}']), ['menu {', '  action "', '    f()', '  "', '}']);
    });

    it('keeps white space as the last character of a `` ` `` block, which the engine drops', () => {
      // The dropped character is the line break before the closing backtick; after formatting it is a space.
      const lines = format(['menu {', 'action `', 'f()  ', '`', '}']);
      assert.deepEqual(lines, ['menu {', '  action `', '    f()', '  `', '}']);
      const text = lines.join('\n');
      const block = lexMenu(text).inline[0];
      assert.ok(block);
      assert.equal(text[block.close - 1], ' ');
      // A character before the backtick that is not white space is never touched: here the engine
      // drops `)` and runs `f(`, a syntax error, so the block is left as written.
      assert.deepEqual(format(['menu {', 'action `', 'f()`', '}']), ['menu {', '  action `', 'f()`', '}']);
    });

    it('leaves a chunk with a syntax error exactly as written, and formats the rest', () => {
      const text = ['menu {', 'onOpen "', 'if x then', '"', 'name "m"', '}'].join('\n');
      const result = formatMenuDocument(parseDocument(text, 'menu'), SPACES);
      assert.ok(result.ok);
      assert.equal(result.unformatted, 1);
      assert.equal(edited(text, result), ['menu {', '  onOpen "', 'if x then', '"', '  name "m"', '}'].join('\n'));
    });

    it('formats the Lua of slotinfo and other generated forms', () => {
      assert.deepEqual(format(['menu {', 'slotinfo "slots[ 1 ]"', '}']), ['menu {', '  slotinfo "slots[1]"', '}']);
    });
  });

  describe('refusals and options', () => {
    it('refuses files with an unterminated string or `` ` `` block', () => {
      for (const text of ['menu {\nname "m\n}', 'menu {\n`x = 1\n}']) {
        assert.deepEqual(formatMenuDocument(parseDocument(text, 'menu'), SPACES), { ok: false, reason: 'syntax-error' });
      }
    });

    it('refuses invalid options', () => {
      assert.deepEqual(formatMenuDocument(parseDocument('menu {}', 'menu'), { tabSize: 0, insertSpaces: true }), {
        ok: false,
        reason: 'invalid-options',
      });
    });

    it('inserts a final newline and trims final newlines when asked to', () => {
      const parse = (text: string) => parseDocument(text, 'menu');
      assert.equal(edited('menu {}', formatMenuDocument(parse('menu {}'), { ...SPACES, insertFinalNewline: true })), 'menu {}\n');
      assert.equal(edited('menu {}\n\n  \n', formatMenuDocument(parse('menu {}\n\n  \n'), { ...SPACES, trimFinalNewlines: true })), 'menu {}\n');
      assert.equal(edited('menu {}\n\n', formatMenuDocument(parse('menu {}\n\n'), SPACES)), 'menu {}\n\n');
    });
  });

  describe('range formatting', () => {
    it('formats only the lines the range touches', () => {
      const text = 'menu {\nname "m"\nlabel {\ntext "t"\n}\n}';
      const result = formatMenuRange(parseDocument(text, 'menu'), SPACES, text.indexOf('label'), text.indexOf('label') + 1);
      assert.equal(edited(text, result), 'menu {\nname "m"\n  label {\ntext "t"\n}\n}');
    });

    it('formats the Lua lines of the range', () => {
      const text = 'menu {\naction "\nif x then\ny()\nend\n"\n}';
      const at = text.indexOf('y()');
      assert.equal(edited(text, formatMenuRange(parseDocument(text, 'menu'), SPACES, at, at)), 'menu {\naction "\nif x then\n      y()\nend\n"\n}');
    });
  });

  describe('on-type formatting', () => {
    const onType = (text: string, offset: number, character: string): string =>
      edited(text, formatMenuOnType(parseDocument(text, 'menu'), SPACES, offset, character));

    it('formats the line a line break ended, and the new line when it has text', () => {
      const text = 'menu {\nname "m"   \n}';
      assert.equal(onType(text, text.indexOf('}'), '\n'), 'menu {\n  name "m"\n}');
      const blank = 'menu {\nname "m"\n\n}';
      assert.equal(onType(blank, blank.indexOf('\n\n') + 1, '\n'), 'menu {\n  name "m"\n\n}');
    });

    it('re-indents a line whose first character, a `}`, was just typed', () => {
      const text = 'menu {\n  name "m"\n    }';
      assert.equal(onType(text, text.length, '}'), 'menu {\n  name "m"\n}');
      // Not when `}` is not the first character of the line, or is inside a string.
      const inside = 'menu {\n  text "  }';
      assert.equal(onType(`${inside}"\n}`, inside.length, '}'), `${inside}"\n}`);
    });

    it('re-indents a Lua line whose first token, a closer, was just typed', () => {
      const text = 'menu {\n  action "\n    if x then\n      y()\n      end\n  "\n}';
      const offset = text.indexOf('      end') + '      end'.length;
      assert.equal(onType(text, offset, 'd'), 'menu {\n  action "\n    if x then\n      y()\n    end\n  "\n}');
      assert.equal(onType(text, offset, 'x'), text);
    });
  });

  describe('properties', () => {
    const fixtures = join(import.meta.dirname, '../../../fixtures/workspace');
    const SAMPLES = readdirSync(fixtures)
      .filter((name) => /\.menu$/i.test(name))
      .map((name) => readFileSync(join(fixtures, name), 'utf8'));

    it('formats every .menu fixture without changing what the engine reads, and is idempotent', () => {
      assert.ok(SAMPLES.length >= 5, `only ${SAMPLES.length} fixtures`);
      for (const text of SAMPLES) {
        const result = formatMenuDocument(parseDocument(text, 'menu'), SPACES);
        if (!result.ok) {
          // Only the deliberately broken fixtures may be refused.
          assert.equal(result.reason, 'syntax-error');
          continue;
        }
        const once = applyEdits(text, result.edits);
        const again = formatMenuDocument(parseDocument(once, 'menu'), SPACES);
        assert.ok(again.ok);
        assert.deepEqual(again.edits, [], `not idempotent:\n${once}`);
        assert.equal(once.split(/\r\n|\r|\n/).length, text.split(/\r\n|\r|\n/).length);
      }
    });
  });
});
