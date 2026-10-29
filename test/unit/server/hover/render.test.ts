import assert from 'node:assert/strict';
import { createMessages } from '../../../../src/server/l10n.ts';
import { renderDocumentation, renderHover, renderSignature, type HoverFormat } from '../../../../src/server/hover/render.ts';
import { hoverTargetAt } from '../../../../src/server/hover/resolve.ts';
import { parseDocument } from '../../../../src/server/syntax/document.ts';

const english = createMessages(undefined);

/** The hover text at the first `needle` of `text`, `offset` characters into it. */
function render(text: string, needle: string, format: HoverFormat = 'markdown', { offset = 0, locale = undefined as string | undefined } = {}): string {
  const at = text.indexOf(needle);
  assert.ok(at >= 0, needle);
  const hit = hoverTargetAt(parseDocument(text, 'lua'), at + offset);
  assert.ok(hit, `no hover at "${needle}"`);
  return renderHover(hit.target, format, locale === undefined ? english : createMessages(locale));
}

const fence = (code: string): string => `\`\`\`lua\n${code}\n\`\`\``;

describe('server/hover/render', () => {
  describe('locals', () => {
    const text = 'local function f(a, b, ...) for i = 1, 2 do end end local g = function(c) end local x, y = 1 function t:m() return self end';

    it('shows how each local is declared', () => {
      assert.equal(render(text, 'f('), fence('local function f(a, b, ...)'));
      assert.equal(render(text, 'g ='), fence('local g = function(c)'));
      assert.equal(render(text, 'x,'), fence('local x'));
      assert.equal(render(text, 'y ='), fence('local y'));
      assert.equal(render(text, 'a,'), fence('(parameter) a'));
      assert.equal(render(text, 'self'), fence('(parameter) self'));
      assert.equal(render(text, 'i ='), fence('(for variable) i'));
    });

    it('localizes the server\'s own labels', () => {
      assert.equal(render(text, 'a,', 'markdown', { locale: 'de' }), fence('(Parameter) a'));
      assert.equal(render(text, 'i =', 'markdown', { locale: 'fr-CA' }), fence('(variable for) i'));
    });

    it('renders plain text without fences', () => {
      assert.equal(render(text, 'f(', 'plaintext'), 'local function f(a, b, ...)');
    });
  });

  describe('globals', () => {
    it('shows the first assignment of a global the document defines', () => {
      assert.equal(render('function G(a) end', 'G'), fence('(global) function G(a)'));
      assert.equal(render('H = function(...) end', 'H'), fence('(global) H = function(...)'));
      assert.equal(render('K = 1', 'K'), fence('(global) K'));
      assert.equal(render('unknownGlobal()', 'unknown'), fence('(global) unknownGlobal'));
      assert.equal(render('io.write()', 'io', 'markdown', { locale: 'ja' }), fence('(グローバル) io'));
    });

    it('links an EEex-Docs name the document redefines', () => {
      const markdown = render('Infinity_DisplayString = nil', 'Infinity');
      assert.match(markdown, /^```lua\n\(global\) Infinity_DisplayString\n```\n\n---\n\n\[EE Game Lua Functions\]\(https:\/\/eeex-docs\.readthedocs\.io\/[^)]+\)$/);
    });
  });

  describe('libraries', () => {
    it('quotes the manual entry with its heading and a link to its section', () => {
      assert.equal(
        render('return math.huge', 'huge'),
        `${fence('math.huge')}\n\n---\n\nThe value \`HUGE_VAL\`, a value larger than or equal to any other numerical value.\n\n---\n\n` +
          '[Lua 5.2 Reference Manual, §6.6 – Mathematical Functions](https://www.lua.org/manual/5.2/manual.html#pdf-math.huge)',
      );
      assert.equal(
        render('return math.huge', 'huge', 'plaintext'),
        'math.huge\n\nThe value HUGE_VAL, a value larger than or equal to any other numerical value.\n\n' +
          'Lua 5.2 Reference Manual, §6.6 – Mathematical Functions: https://www.lua.org/manual/5.2/manual.html#pdf-math.huge',
      );
      assert.ok(render('string.format()', 'format').startsWith(fence('string.format (formatstring, ···)')));
      assert.ok(render('return string', 'string').endsWith('[Lua 5.2 Reference Manual, §6.4 – String Manipulation](https://www.lua.org/manual/5.2/manual.html#6.4)'));
    });

    it('replaces the manual text of print with a note on the engine, in the display language', () => {
      const iesdp = 'https://gibberlings3.github.io/iesdp/file_formats/ie_formats/lua_globals.htm';
      assert.equal(
        render('print(1)', 'print'),
        `${fence('print (···)')}\n\n---\n\n` +
          `The game engine replaces \`print\` with its own function, so the description in the Lua 5.2 manual does not apply. See [IESDP: Engine Lua globals](${iesdp}).`,
      );
      assert.equal(
        render('print(1)', 'print', 'plaintext'),
        `print (···)\n\nThe game engine replaces print with its own function, so the description in the Lua 5.2 manual does not apply. See IESDP: Engine Lua globals (${iesdp}).`,
      );
      assert.match(render('print(1)', 'print', 'markdown', { locale: 'de' }), /Die Spiel-Engine ersetzt `print` durch eine eigene Funktion/);
    });

    it('links EEex-Docs functions by their documented name', () => {
      const markdown = render('C:AddGold(1)', 'AddGold');
      assert.match(markdown, /^```lua\nC:AddGold\n```\n\n---\n\n\[EE Game Lua Functions\]\(https:\/\/eeex-docs\.readthedocs\.io\/[^)]+\)$/);
      assert.match(render('EEex_AIBase_GetScriptLevel()', 'EEex', 'plaintext'), /^EEex_AIBase_GetScriptLevel\n\nEEex Functions: https:\/\/eeex-docs\.readthedocs\.io\//);
    });
  });

  describe('signature and documentation separately', () => {
    const hit = (text: string, needle: string): Parameters<typeof renderHover>[0] => {
      const found = hoverTargetAt(parseDocument(text, 'lua'), text.indexOf(needle));
      assert.ok(found, needle);
      return found.target;
    };

    it('make up the hover: code line, then documentation and link', () => {
      for (const [text, needle] of [['return math.huge', 'huge'], ['print(1)', 'print'], ['C:AddGold(1)', 'AddGold'], ['local x = 1 return x', 'x']] as const) {
        const target = hit(text, needle);
        for (const format of ['markdown', 'plaintext'] as const) {
          const code = format === 'markdown' ? fence(renderSignature(target, english)) : renderSignature(target, english);
          const documentation = renderDocumentation(target, format, english);
          const separator = format === 'markdown' ? '\n\n---\n\n' : '\n\n';
          assert.equal(renderHover(target, format, english), documentation === undefined ? code : `${code}${separator}${documentation}`, `${needle} ${format}`);
        }
      }
    });

    it('give the code line alone for names without documentation', () => {
      const target = hit('local function f(a) end', 'f(');
      assert.equal(renderSignature(target, english), 'local function f(a)');
      assert.equal(renderDocumentation(target, 'markdown', english), undefined);
    });
  });
});
