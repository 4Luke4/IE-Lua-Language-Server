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
      const found = validateText(text, 'menu', lua);
      // The `end` the engine appends is what the compiler stumbles on: an empty range at the end of each chunk.
      assert.deepEqual(found.map((p) => [p.code, text[p.start], p.start === p.end, p.message]), [
        ['lua-syntax', '"', true, "unexpected symbol near 'end'"],
        ['lua-syntax', '"', true, "unexpected symbol near 'end'"],
      ]);
    });

    it('rejects ... in property code, which the engine compiles into a function that is not vararg', () => {
      assert.deepEqual(problems('action "print(...)"', 'menu', lua), [
        ['lua-syntax', '...', "cannot use '...' outside a vararg function near '...'"],
      ]);
      assert.deepEqual(problems('`print(...) `', 'menu', lua), []);
    });

    it('rejects a trailing -- comment in property code, which comments out the end the engine appends', () => {
      const [problem] = problems('action "f() -- note"', 'menu', lua);
      assert.match(problem?.[2] ?? '', /'end' expected near <eof>/);
      assert.deepEqual(problems('action "f() -- note\n"', 'menu', lua), []);
    });

    it('compiles a backtick block without its last character, as the engine does', () => {
      assert.deepEqual(problems('`x = 1`', 'menu', lua).map(([code, found]) => [code, found]), [
        ['menu-inline-lua-last-character', '1'],
        ['lua-syntax', ''],
      ]);
      assert.deepEqual(problems('`x = 1\n`', 'menu', lua), []);
    });

    it('points at a token of the property code when it occurs once on the line', () => {
      assert.deepEqual(problems('action "a b"', 'menu', lua), [['lua-syntax', 'b', "syntax error near 'b'"]]);
    });

    it('validates slotinfo, spellInfo and memorizedSpellInfo in every form the engine generates', () => {
      const valid = 'slot { slotinfo "characters[id].equipment.weapon0" spellInfo \'t[1]\' memorizedSpellInfo "s" }';
      assert.deepEqual(problems(valid, 'menu', lua), []);
      // `return 1` compiles, but the engine generates `return 1.item.icon`: `1.` is a number, then `item`
      // (generated text) is unexpected, so the problem is an empty range at the end of the string.
      assert.deepEqual(problems('slotinfo "1"', 'menu', lua), [['lua-syntax', '', "'end' expected near 'item'"]]);
      assert.equal(validateText('spellInfo "\'s\'"', 'menu', lua).length, 1);
      assert.equal(validateText('memorizedSpellInfo "a b"', 'menu', lua).length, 1);
    });

    it('rejects code that only parses as a chunk, not as a function body or return value', () => {
      assert.equal(validateText('enabled "a; b"', 'menu', lua).length, 1);
      assert.equal(validateText('enabled "a return b"', 'menu', lua).length, 1);
    });

    it('accepts valid expressions and statements', () => {
      const text = 'menu\n{\n\tname \'M\'\n\tenabled "x == 1 and not y"\n\tlabel\n\t{\n\t\ttext lua "t[1] .. \'s\'"\n\t\taction "Infinity_PopMenu()"\n\t}\n}\n';
      assert.deepEqual(problems(text, 'menu', lua), []);
    });

    it('rejects statements where an expression is required', () => {
      assert.equal(validateText('enabled "x = 1"', 'menu', lua).length, 1);
    });

    it('reports Lua syntax errors as errors and misread menu text as warnings', () => {
      const found = validateText('a_b action "f("', 'menu', lua);
      assert.deepEqual(found.map((p) => [p.code, p.severity]), [
        ['menu-unquoted-underscore', 'warning'],
        ['lua-syntax', 'error'],
      ]);
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
