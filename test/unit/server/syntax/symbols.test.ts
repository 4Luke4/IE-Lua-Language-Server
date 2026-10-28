import assert from 'node:assert/strict';
import { parseDocument } from '../../../../src/server/syntax/document.ts';
import { documentSymbols, type OutlineSymbol } from '../../../../src/server/syntax/symbols.ts';

/** `kind name detail` per symbol, children indented. */
function outline(text: string, kind: 'lua' | 'menu' = 'lua'): string[] {
  const lines: string[] = [];
  const walk = (symbols: readonly OutlineSymbol[], depth: number): void => {
    for (const s of symbols) {
      lines.push(`${'  '.repeat(depth)}${s.kind} ${s.name}${s.detail ? ` ${s.detail}` : ''}`);
      walk(s.children, depth + 1);
    }
  };
  walk(documentSymbols(parseDocument(text, kind), text.length), 0);
  return lines;
}

/** Checks the LSP invariant selection ⊆ range for every symbol, recursively. */
function assertWellFormed(symbols: readonly OutlineSymbol[]): void {
  for (const s of symbols) {
    assert.ok(s.name.length > 0);
    assert.ok(s.start <= s.selectionStart && s.selectionEnd <= s.end && s.selectionStart <= s.selectionEnd, s.name);
    assertWellFormed(s.children);
  }
}

describe('server/syntax/symbols', () => {
  it('lists every kind of function declaration, with its parameters', () => {
    assert.deepEqual(
      outline('function a.b.c(x, ...) end\nfunction obj:m(y) end\nlocal function f() end\nlocal g = function() end\nh = function(z) end\nt.u = function() end'),
      [
        'function a.b.c (x, ...)',
        'method obj:m (y)',
        'function f ()',
        'function g ()',
        'function h (z)',
        'function t.u ()',
      ],
    );
  });

  it('nests functions under the function that contains them', () => {
    assert.deepEqual(outline('function outer()\n  local function inner() end\n  callback(function() function deep() end end)\nend'), [
      'function outer ()',
      '  function inner ()',
      '  function deep ()',
    ]);
  });

  it('lists top-level locals and the first assignment to each global, with table fields', () => {
    assert.deepEqual(outline('local a, b = 1\nconfig = { size = 2, run = function() end, nested = { x = 1 }, 3 }\nconfig = {}\n'), [
      'variable a',
      'variable b',
      'variable config',
      '  field size',
      '  function run ()',
      '  field nested',
      '    field x',
    ]);
  });

  it('omits locals in blocks or functions, and assignments to existing locals', () => {
    assert.deepEqual(outline('local x = 1\nx = 2\ndo local hidden = 1 end\nif c then shown = 1 end\nfunction f() local y = 1; g = 2 end'), [
      'variable x',
      'variable shown',
      'function f ()',
    ]);
  });

  it('gives every symbol a selection range on its name, inside its range', () => {
    const text = 'function a.b:c() end\nlocal t = { f = function() end }';
    const symbols = documentSymbols(parseDocument(text, 'lua'), text.length);
    assertWellFormed(symbols);
    const [method] = symbols;
    assert.ok(method);
    assert.equal(text.slice(method.selectionStart, method.selectionEnd), 'a.b:c');
    assert.equal(text.slice(method.start, method.end), 'function a.b:c() end');
  });

  it('still lists symbols around a syntax error', () => {
    assert.deepEqual(outline('function ok() end\nx = = 1\nfunction unfinished()\n  local y = 1\n'), [
      'function ok ()',
      'function unfinished ()',
    ]);
  });

  describe('.menu files', () => {
    const menu = [
      '`',
      'function topLevel() end',
      'state = 1',
      '`',
      'menu',
      '{',
      "\tname 'MAIN'",
      '\tonOpen "function opened() end; counter = 1"',
      '\tbutton',
      '\t{',
      '\t\tenabled "ready"',
      '\t}',
      '}',
      'menu',
      '{',
      '}',
    ].join('\n');

    it('lists each menu by name with the Lua symbols inside it', () => {
      assert.deepEqual(outline(menu, 'menu'), [
        'function topLevel ()',
        'variable state',
        'namespace MAIN',
        '  function opened ()',
        'namespace menu',
      ]);
    });

    it('selects the menu name, and the menu keyword when it has no name', () => {
      const symbols = documentSymbols(parseDocument(menu, 'menu'), menu.length);
      assertWellFormed(symbols);
      const names = symbols.filter((s) => s.kind === 'namespace').map((s) => menu.slice(s.selectionStart, s.selectionEnd));
      assert.deepEqual(names, ['MAIN', 'menu']);
    });

    it('extends an unclosed menu to the end of the document', () => {
      const text = 'menu\n{\n\tname "OPEN"\n';
      const [symbol] = documentSymbols(parseDocument(text, 'menu'), text.length);
      assert.equal(symbol?.end, text.length);
    });
  });
});
