import assert from 'node:assert/strict';
import { parseDocument } from '../../../../src/server/syntax/document.ts';
import { hoverTargetAt, type HoverTarget } from '../../../../src/server/hover/resolve.ts';

/** A compact description of a hover target, for comparison. */
function summary(target: HoverTarget): string {
  switch (target.kind) {
    case 'local':
      return `local ${target.declaration.kind} ${target.declaration.name} ${target.site?.kind ?? '-'}`;
    case 'global':
      return `global ${target.name} ${target.site?.kind ?? '-'} ${target.link?.name ?? '-'}`;
    case 'library':
      return `library ${target.entry.name}`;
    case 'engineReplaced':
      return `engine ${target.replacement.name}`;
    case 'external':
      return `external ${target.entry.name}`;
  }
}

/**
 * Hover at the `occurrence`-th `needle` of `text`, `offset` characters into it:
 * `name -> summary`, or `undefined` when there is no hover.
 */
function hover(text: string, needle: string, { occurrence = 0, offset = 0, kind = 'lua' }: { occurrence?: number; offset?: number; kind?: 'lua' | 'menu' } = {}): string | undefined {
  let at = -1;
  for (let i = 0; i <= occurrence; i++) {
    at = text.indexOf(needle, at + 1);
    assert.ok(at >= 0, `"${needle}" #${String(i)} not found`);
  }
  const hit = hoverTargetAt(parseDocument(text, kind), at + offset);
  return hit && `${hit.identifier.name} -> ${summary(hit.target)}`;
}

describe('server/hover/resolve', () => {
  describe('variables', () => {
    it('describes locals by their declaration', () => {
      const text = 'local function f(a, ...) for i = 1, a do local x, y = i end end return f';
      assert.equal(hover(text, 'f', { occurrence: 1 }), 'f -> local localFunction f localFunction');
      assert.equal(hover(text, 'return f', { offset: 7 }), 'f -> local localFunction f localFunction');
      assert.equal(hover(text, 'a,'), 'a -> local parameter a -');
      assert.equal(hover(text, 'i ='), 'i -> local forVariable i -');
      assert.equal(hover(text, 'x,'), 'x -> local local x local');
      assert.equal(hover('function t:m() return self end', 'self'), 'self -> local self self -');
    });

    it('describes a global the document assigns by its first assignment, also across .menu chunks', () => {
      assert.equal(hover('function G(a) end G()', 'G', { occurrence: 1 }), 'G -> global G functionDeclaration -');
      const menu = 'menu { onOpen "Total = Total + 1" } menu { onOpen "print(Total)" }';
      assert.equal(hover(menu, 'Total', { occurrence: 2, kind: 'menu' }), 'Total -> global Total assignment -');
    });

    it('lets the document\'s own definition win over the libraries, keeping EEex-Docs links', () => {
      assert.equal(hover('function print() end print()', 'print', { occurrence: 1 }), 'print -> global print functionDeclaration -');
      assert.equal(hover('string = {} string.format()', 'format'), undefined);
      assert.equal(
        hover('Infinity_DisplayString = nil Infinity_DisplayString()', 'Infinity_DisplayString', { occurrence: 1 }),
        'Infinity_DisplayString -> global Infinity_DisplayString assignment Infinity_DisplayString',
      );
    });

    it('documents library and EEex-Docs globals, and the engine\'s print', () => {
      assert.equal(hover('pairs(t)', 'pairs'), 'pairs -> library pairs');
      assert.equal(hover('local s = string', 'string'), 'string -> library string');
      assert.equal(hover('print(1)', 'print'), 'print -> engine print');
      assert.equal(hover('EEex_AIBase_GetScriptLevel()', 'EEex'), 'EEex_AIBase_GetScriptLevel -> external EEex_AIBase_GetScriptLevel');
    });

    it('gives no documentation for libraries the engine does not open', () => {
      for (const name of ['io', 'os', 'require', 'coroutine', 'unknownGlobal']) {
        assert.equal(hover(`${name}()`, name), `${name} -> global ${name} - -`);
      }
    });

    it('selects a name when the cursor is just after it', () => {
      assert.equal(hover('pairs(t)', 'pairs', { offset: 5 }), 'pairs -> library pairs');
    });
  });

  describe('fields and methods', () => {
    it('documents library members, also through _G and on string literals', () => {
      assert.equal(hover('string.format("%d", 1)', 'format'), 'format -> library string.format');
      assert.equal(hover('return math.pi', 'pi'), 'pi -> library math.pi');
      assert.equal(hover('_G.string.format()', 'format'), 'format -> library string.format');
      assert.equal(hover('_G.string.format()', 'string'), 'string -> library string');
      assert.equal(hover('_G.print()', 'print'), 'print -> engine print');
      assert.equal(hover('("x"):rep(3)', 'rep'), 'rep -> library string.rep');
      assert.equal(hover('local s = "x" .. ("y"):upper()', 'upper'), 'upper -> library string.upper');
    });

    it('documents EEex-Docs methods and dotted names', () => {
      assert.equal(hover('C:AddGold(10)', 'AddGold'), 'AddGold -> external C:AddGold');
      assert.equal(hover('C.AddGold(C, 10)', 'AddGold'), 'AddGold -> external C:AddGold');
      assert.equal(hover('worldScreen:CheckIfPaused()', 'CheckIfPaused'), 'CheckIfPaused -> external worldScreen:CheckIfPaused');
      assert.equal(hover('EEex_Options_Option.new({})', 'new'), 'new -> external EEex_Options_Option.new');
    });

    it('gives no hover for members of locals, unknown tables or other libraries', () => {
      assert.equal(hover('local string = {} string.format()', 'format'), undefined);
      assert.equal(hover('local s = "" s:rep(2)', 'rep'), undefined);
      assert.equal(hover('io.write("x")', 'write'), undefined);
      assert.equal(hover('os.time()', 'time'), undefined);
      assert.equal(hover('t.x = 1', 'x'), undefined);
      assert.equal(hover('string.format.x()', 'x'), undefined);
      assert.equal(hover('f().format()', 'format'), undefined);
    });
  });

  describe('_ENV', () => {
    it('gives no hover for names resolved through a local _ENV, nor for _ENV itself', () => {
      assert.equal(hover('local _ENV = {} print(1)', 'print'), undefined);
      assert.equal(hover('local function f(_ENV) return string.format end', 'format'), undefined);
      assert.equal(hover('local function f(_ENV) return string.format end', 'string'), undefined);
      assert.equal(hover('return _ENV', '_ENV'), undefined);
      // Outside the local's scope, globals are globals again.
      assert.equal(hover('do local _ENV = {} end print(1)', 'print'), 'print -> engine print');
    });
  });

  it('gives no hover outside names', () => {
    const cases: [string, string][] = [['local x = 1', 'local'], ['x = "print"', 'print'], ['-- print', 'print'], ['x = 1 + 2', '+']];
    for (const [text, needle] of cases) {
      assert.equal(hover(text, needle), undefined, text);
    }
    assert.equal(hover('menu { name "print" }', 'name', { kind: 'menu' }), undefined);
  });
});
