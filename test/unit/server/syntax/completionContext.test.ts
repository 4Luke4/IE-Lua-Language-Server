import assert from 'node:assert/strict';
import { completionSiteAt } from '../../../../src/server/syntax/completionContext.ts';
import { parseDocument } from '../../../../src/server/syntax/document.ts';

/**
 * The completion site where `|` is in `marked` (the marker is removed first),
 * as `context [prefix] start-end`, or `undefined` when there is none.
 */
function site(marked: string, kind: 'lua' | 'menu' = 'lua'): string | undefined {
  const offset = marked.indexOf('|');
  assert.ok(offset >= 0 && marked.indexOf('|', offset + 1) < 0, 'exactly one marker');
  const text = marked.slice(0, offset) + marked.slice(offset + 1);
  const found = completionSiteAt(parseDocument(text, kind), text, offset);
  if (!found) return undefined;
  const { context } = found;
  const description =
    context.kind === 'member' ? `${context.path.join('.')}${context.operator}` : context.kind;
  return `${description}${found.expression ? ' (expression)' : ''} [${found.prefix}] ${String(found.start)}-${String(found.end)}`;
}

describe('server/syntax/completionContext', () => {
  describe('variables', () => {
    it('completes the name before the cursor, replacing the whole name', () => {
      assert.equal(site('pri|'), 'variable [pri] 0-3');
      assert.equal(site('pri|nt()'), 'variable [pri] 0-5');
      assert.equal(site('x = |'), 'variable [] 4-4');
      assert.equal(site('|'), 'variable [] 0-0');
    });

    it('treats a keyword being typed as a prefix (`do` may become `dofile`)', () => {
      assert.equal(site('do|'), 'variable [do] 0-2');
      assert.equal(site('x = f(a) and|'), 'variable [and] 9-12');
    });

    it('completes after operators, `..`, `(`, `,` and keywords that start expressions', () => {
      assert.equal(site('x = a .. |'), 'variable [] 9-9');
      assert.equal(site('x = a..b|'), 'variable [b] 7-8');
      assert.equal(site('f(a, |'), 'variable [] 5-5');
      assert.equal(site('if |'), 'variable [] 3-3');
      assert.equal(site('return |'), 'variable [] 7-7');
      assert.equal(site('for k, v in |'), 'variable [] 12-12');
      assert.equal(site('local a, b = |'), 'variable [] 13-13');
      assert.equal(site('::top:: |'), 'variable [] 8-8');
    });
  });

  describe('nothing to complete', () => {
    it('in comments', () => {
      assert.equal(site('-- pri|'), undefined);
      assert.equal(site('--[[ pri|'), undefined);
      assert.equal(site('--[[ pri|\n]]'), undefined);
      assert.equal(site('--[==[ ]] pri|'), undefined);
      assert.equal(site('--[[ x ]]|'), 'variable [] 9-9');
      assert.equal(site('-- x\n|'), 'variable [] 5-5');
    });

    it('in strings and numbers', () => {
      assert.equal(site('x = "pri|'), undefined);
      assert.equal(site('x = "pri|"'), undefined);
      assert.equal(site('x = [[pri|]]'), undefined);
      assert.equal(site('x = "a"|'), undefined);
      assert.equal(site('x = 1|'), undefined);
      assert.equal(site('x = 1.|'), undefined);
    });

    it('where a name is declared', () => {
      assert.equal(site('local |'), undefined);
      assert.equal(site('local x|'), undefined);
      assert.equal(site('local a, |'), undefined);
      assert.equal(site('local function |'), undefined);
      assert.equal(site('function |'), undefined);
      assert.equal(site('function t.|'), undefined);
      assert.equal(site('function t:m|'), undefined);
      assert.equal(site('function f(|'), undefined);
      assert.equal(site('function t.a:b(x, |'), undefined);
      assert.equal(site('x = function(a, b|'), undefined);
      assert.equal(site('for |'), undefined);
      assert.equal(site('for k, |'), undefined);
      assert.equal(site('goto |'), undefined);
      assert.equal(site('::|'), undefined);
    });

    it('after members of anything but a chain of names', () => {
      assert.equal(site('f().|'), undefined);
      assert.equal(site('t[1].|'), undefined);
      assert.equal(site('t[1].a.|'), undefined);
      assert.equal(site('x = "s":|'), undefined);
    });
  });

  describe('members', () => {
    it('follows `.` chains of names', () => {
      assert.equal(site('string.|'), 'string. [] 7-7');
      assert.equal(site('string.fo|rmat'), 'string. [fo] 7-13');
      assert.equal(site('_G.string.|'), '_G.string. [] 10-10');
      assert.equal(site('x = a .b. |'), 'a.b. [] 10-10');
    });

    it('follows `:` after a chain of names, and `("…"):` for string methods', () => {
      assert.equal(site('C:|'), 'C: [] 2-2');
      assert.equal(site('a.b:c|'), 'a.b: [c] 4-5');
      assert.equal(site('x = ("x"):r|'), 'stringMethod [r] 10-11');
      assert.equal(site('x = ([[x]]):|'), 'stringMethod [] 12-12');
    });

    it('completes members in incomplete code inside a function', () => {
      assert.equal(site('local function f(a)\n  string.|\nend'), 'string. [] 29-29');
    });
  });

  describe('.menu files', () => {
    const menu = (code: string): string => `menu\n{\n\tname 'M'\n\t${code}\n}\n`;

    it('completes only inside the Lua chunks', () => {
      assert.equal(site(menu('onOpen "pri|"'), 'menu'), 'variable [pri] 26-29');
      assert.equal(site(menu('enabled "x |"'), 'menu'), 'variable (expression) [] 29-29');
      assert.equal(site(menu('ena|bled "x"'), 'menu'), undefined);
      assert.equal(site(`\`\nstring.| \`\n${menu('')}`, 'menu'), 'string. [] 9-9');
      assert.equal(site(`|${menu('')}`, 'menu'), undefined);
    });
  });
});
