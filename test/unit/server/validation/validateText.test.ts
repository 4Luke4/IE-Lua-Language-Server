import assert from 'node:assert/strict';
import { loadLua52, type Lua52Checker } from '../../../../src/server/validation/lua52.ts';
import { documentKind, validateText, type DocumentKind } from '../../../../src/server/validation/validateText.ts';

/** [code, problem text, message] — easier to read than raw offsets. */
function problems(text: string, kind: DocumentKind, lua: Lua52Checker): [string, string, string][] {
  return validateText(text, kind, lua).map((p) => [p.code, text.slice(p.start, p.end), p.message]);
}

describe('server/validation/validateText (official Lua 5.2.4 compiler)', () => {
  let lua: Lua52Checker;
  before(async () => {
    lua = await loadLua52();
  });

  it('accepts valid Lua 5.2, including goto and labels', () => {
    assert.deepEqual(problems('local t = {}\nfor i = 1, 3 do\n  if i == 2 then goto skip end\n  t[#t + 1] = i\n  ::skip::\nend\n', 'lua', lua), []);
  });

  it('points at the offending token when it occurs once on its line', () => {
    const text = 'local t = {}\nt.x 1\n';
    assert.deepEqual(problems(text, 'lua', lua), [['lua-syntax', '1', "syntax error near '1'"]]);
  });

  it('reports the whole line when the token occurs more than once on it', () => {
    const text = 'a = 1\nb = = 2\n';
    assert.deepEqual(problems(text, 'lua', lua), [['lua-syntax', 'b = = 2', "unexpected symbol near '='"]]);
  });

  it('reports <eof> errors as an empty range at the end of the chunk', () => {
    const text = 'function f()\n  return 1\n';
    const [problem] = validateText(text, 'lua', lua);
    assert.ok(problem);
    assert.equal(problem.start, text.length);
    assert.equal(problem.end, text.length);
    assert.match(problem.message, /'end' expected \(to close 'function' at line 1\) near <eof>/);
  });

  it('rejects syntax that only LuaJIT accepts', () => {
    assert.equal(validateText('local n = 1LL\n', 'lua', lua).length, 1);
  });

  it('never executes code', () => {
    assert.deepEqual(problems('error("must not run")\nos.exit(1)\n', 'lua', lua), []);
  });

  it('rejects precompiled bytecode', () => {
    assert.equal(validateText('\x1bLua\x52\x00', 'lua', lua).length, 1);
  });

  describe('.menu documents', () => {
    it('validates each embedded chunk and maps problems back into the document', () => {
      const text = '`\nfunction ok() return 1 end\n`\nmenu\n{\n\tbutton\n\t{\n\t\tenabled "a =="\n\t\taction\n\t\t"\n\t\t\tfoo(\n\t\t"\n\t}\n}\n';
      const found = problems(text, 'menu', lua);
      assert.equal(found.length, 2);
      assert.deepEqual(found.map(([code]) => code), ['lua-syntax', 'lua-syntax']);
      for (const [, , message] of found) {
        assert.match(message, /near <eof>/);
      }
    });

    it('accepts valid expressions and statements', () => {
      const text = 'menu\n{\n\tname \'M\'\n\tenabled "x == 1 and not y"\n\tlabel\n\t{\n\t\ttext lua "t[1] .. \'s\'"\n\t\taction "Infinity_PopMenu()"\n\t}\n}\n';
      assert.deepEqual(problems(text, 'menu', lua), []);
    });

    it('rejects statements where an expression is required', () => {
      assert.equal(validateText('enabled "x = 1"', 'menu', lua).length, 1);
    });

    it('includes extractor problems', () => {
      assert.deepEqual(problems('action "x()', 'menu', lua).map(([code]) => code), ['menu-unterminated-string']);
    });
  });
});

describe('server/validation/validateText documentKind', () => {
  it('treats ie-menu documents and any *.menu file as menus, whatever the editor calls them', () => {
    assert.equal(documentKind('file:///x/UI.MENU', 'plaintext'), 'menu');
    assert.equal(documentKind('file:///x/ui.menu', 'iemenu'), 'menu');
    assert.equal(documentKind('untitled:Untitled-1', 'ie-menu'), 'menu');
    assert.equal(documentKind('file:///x/M_test.lua', 'lua'), 'lua');
    assert.equal(documentKind('file:///x/menu.lua', 'lua'), 'lua');
    assert.equal(documentKind('file:///x.menu/script.lua', 'lua'), 'lua');
  });
});
