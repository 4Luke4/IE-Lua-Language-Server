import assert from 'node:assert/strict';
import { classifyNames, TOKEN_MODIFIERS, TOKEN_TYPES } from '../../../../src/server/semanticTokens/classify.ts';
import { parseDocument } from '../../../../src/server/syntax/document.ts';
import { lex } from '../../../../src/server/syntax/lexer.ts';

/** `name type modifier,modifier` for every classified name of `text`, in order. */
function tokens(text: string, kind: 'lua' | 'menu' = 'lua'): string[] {
  return classifyNames(parseDocument(text, kind)).map((token) => `${text.slice(token.start, token.end)} ${token.type} ${[...token.modifiers].sort().join(',')}`.trimEnd());
}

/** The classification of the `occurrence`-th name `name` in `text`. */
function token(text: string, name: string, occurrence = 0, kind: 'lua' | 'menu' = 'lua'): string | undefined {
  return tokens(text, kind).filter((entry) => entry.split(' ')[0] === name)[occurrence];
}

describe('server/semanticTokens/classify', () => {
  describe('locals', () => {
    it('classifies locals and for variables as variables, declared where they are declared', () => {
      const text = 'local x = 1 for i = 1, x do end for k, v in pairs(x) do end return x';
      assert.equal(token(text, 'x'), 'x variable declaration');
      assert.equal(token(text, 'x', 1), 'x variable');
      assert.equal(token(text, 'i'), 'i variable declaration');
      assert.equal(token(text, 'v'), 'v variable declaration');
    });

    it('classifies local functions, and locals declared with a function that is never reassigned, as functions', () => {
      const text = 'local function f() end local g = function() end local h = function() end h = 1 return f, g, h';
      assert.equal(token(text, 'f'), 'f function declaration');
      assert.equal(token(text, 'f', 1), 'f function');
      assert.equal(token(text, 'g', 1), 'g function');
      assert.equal(token(text, 'h'), 'h variable declaration');
      assert.equal(token(text, 'h', 1), 'h variable modification');
    });

    it('classifies parameters and the implicit self as parameters', () => {
      const text = 'function T:m(a, b) return self, a end';
      assert.equal(token(text, 'a'), 'a parameter declaration');
      assert.equal(token(text, 'a', 1), 'a parameter');
      assert.equal(token(text, 'self'), 'self parameter');
    });

    it('marks assignments to locals as modifications', () => {
      assert.equal(token('local x x = 2', 'x', 1), 'x variable modification');
    });

    it('lets a local shadow a library name', () => {
      assert.equal(token('local string = {} return string', 'string', 1), 'string variable');
    });
  });

  describe('globals', () => {
    it('classifies globals the document assigns by their first assignment, without library modifiers', () => {
      const text = 'function G() end V = 1 F = function() end print = nil return G, V, F, print';
      assert.equal(token(text, 'G'), 'G function global,modification');
      assert.equal(token(text, 'G', 1), 'G function global');
      assert.equal(token(text, 'V', 1), 'V variable global');
      assert.equal(token(text, 'F', 1), 'F function global');
      assert.equal(token(text, 'print', 1), 'print variable global');
    });

    it('classifies Lua 5.2 library globals by their manual entry, as default library', () => {
      const text = 'return string, pairs, _VERSION, print';
      assert.equal(token(text, 'string'), 'string namespace defaultLibrary,global');
      assert.equal(token(text, 'pairs'), 'pairs function defaultLibrary,global');
      assert.equal(token(text, '_VERSION'), '_VERSION variable defaultLibrary,global');
      assert.equal(token(text, 'print'), 'print function defaultLibrary,global');
    });

    it('gives EE game functions the default library modifier, and EEex functions not', () => {
      assert.equal(token('Infinity_DisplayString("x")', 'Infinity_DisplayString'), 'Infinity_DisplayString function defaultLibrary,global');
      assert.equal(token('EEex_Sprite_GetName(nil)', 'EEex_Sprite_GetName'), 'EEex_Sprite_GetName function global');
    });

    it('does not offer libraries the engine lacks, and classifies other globals as variables', () => {
      assert.equal(token('return io, require, unknown', 'io'), 'io variable global');
      assert.equal(token('return io, require, unknown', 'require'), 'require variable global');
      assert.equal(token('return io, require, unknown', 'unknown'), 'unknown variable global');
    });

    it('shares the globals of a .menu file across its Lua chunks', () => {
      const menu = 'menu { onOpen "function Show() end" } menu { onOpen "Show()" }';
      assert.equal(token(menu, 'Show', 1, 'menu'), 'Show function global');
    });

    it('does not classify _ENV or names resolved through a local _ENV as globals', () => {
      const text = 'local x = _ENV.print local _ENV = {} y = 1 return print';
      assert.equal(token(text, '_ENV'), '_ENV variable');
      assert.equal(token(text, 'y'), 'y variable modification');
      assert.equal(token(text, 'print', 1), 'print variable');
    });
  });

  describe('fields', () => {
    it('classifies library members by their manual entry, as default library but not global', () => {
      const text = 'string.format("") _G.string.rep("x", 2); ("x"):upper() return _G.print';
      assert.equal(token(text, 'format'), 'format function defaultLibrary');
      assert.equal(token(text, 'string', 1), 'string namespace defaultLibrary,global');
      assert.equal(token(text, 'rep'), 'rep function defaultLibrary');
      assert.equal(token(text, 'upper'), 'upper method defaultLibrary');
      assert.equal(token(text, 'print'), 'print function defaultLibrary,global');
    });

    it('classifies EEex-Docs members after the operator they are used with', () => {
      assert.equal(token('C:AddGold(1) return C.AddGold', 'AddGold'), 'AddGold method defaultLibrary');
      assert.equal(token('C:AddGold(1) return C.AddGold', 'AddGold', 1), 'AddGold function defaultLibrary');
    });

    it('classifies other fields as properties and method calls as methods', () => {
      const text = 'local t = {} t.x = t.y t:m()';
      assert.equal(token(text, 'x'), 'x property modification');
      assert.equal(token(text, 'y'), 'y property');
      assert.equal(token(text, 'm'), 'm method');
    });

    it('does not describe library members the document defines itself', () => {
      assert.equal(token('function string.trim() end string.trim()', 'trim', 1), 'trim property');
      assert.equal(token('string = {} string.format()', 'format'), 'format property');
      assert.equal(token('string.format = nil string.format()', 'format', 1), 'format property');
    });

    it('classifies the names of function declarations after the first', () => {
      const text = 'function a.b.c() end function a.b:m() end';
      assert.equal(token(text, 'a'), 'a variable global');
      assert.equal(token(text, 'b'), 'b property');
      assert.equal(token(text, 'c'), 'c function modification');
      assert.equal(token(text, 'm'), 'm method modification');
    });

    it('declares the named keys of table constructors as properties', () => {
      const text = 'return { x = 1, [y] = 2, 3 }';
      assert.equal(token(text, 'x'), 'x property declaration');
      assert.equal(token(text, 'y'), 'y variable global');
    });
  });

  it('classifies labels', () => {
    const text = 'goto done ::done::';
    assert.deepEqual(tokens(text), ['done label', 'done label declaration']);
  });

  it('classifies the code of a file with syntax errors as far as it was parsed', () => {
    assert.deepEqual(tokens('local x = 1\nif x then = 2\nprint(x)'), ['x variable declaration', 'x variable', 'print function defaultLibrary,global', 'x variable']);
  });

  it('classifies only the Lua of a .menu file', () => {
    const menu = 'menu { name "M" button { text "T" action "local n = 1" } }';
    assert.deepEqual(tokens(menu, 'menu'), ['n variable declaration']);
  });

  it('gives each name of the code exactly one single-line token, sorted, using the legend', () => {
    const text = [
      'local function f(a, ...) return a end',
      'function M.x.y:z(b) self.k = { n = b } end',
      'for i, v in pairs(_G) do ::top:: goto top end',
      'string.format("%d", #arg) ; ("s"):rep(2) C:AddGold(1)',
    ].join('\n');
    const names = lex(text, 0, text.length).tokens.filter((t) => t.type === 'name');
    const classified = classifyNames(parseDocument(text, 'lua'));
    assert.deepEqual(
      classified.map((t) => [t.start, t.end]),
      names.map((t) => [t.start, t.end]),
    );
    for (const t of classified) {
      assert.ok(!text.slice(t.start, t.end).includes('\n'));
      assert.ok(TOKEN_TYPES.includes(t.type));
      for (const modifier of t.modifiers) assert.ok(TOKEN_MODIFIERS.includes(modifier));
      assert.equal(new Set(t.modifiers).size, t.modifiers.length, 'no duplicate modifiers');
    }
  });

  it('classifies a document version once', () => {
    const document = parseDocument('local x = 1', 'lua');
    assert.equal(classifyNames(document), classifyNames(document));
  });
});
