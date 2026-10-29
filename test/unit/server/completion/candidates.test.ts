import assert from 'node:assert/strict';
import { completionCandidates, documentationSource, documentationTarget, type Candidate } from '../../../../src/server/completion/candidates.ts';
import { completionSiteAt } from '../../../../src/server/syntax/completionContext.ts';
import { parseDocument } from '../../../../src/server/syntax/document.ts';

/** The candidates where `|` is in `marked` (the marker is removed first). */
function candidates(marked: string, kind: 'lua' | 'menu' = 'lua'): Candidate[] {
  const offset = marked.indexOf('|');
  assert.ok(offset >= 0 && marked.indexOf('|', offset + 1) < 0, 'exactly one marker');
  const text = marked.slice(0, offset) + marked.slice(offset + 1);
  const document = parseDocument(text, kind);
  const site = completionSiteAt(document, text, offset);
  assert.ok(site, 'no completion site');
  return completionCandidates(document, site);
}

const labels = (marked: string, kind: 'lua' | 'menu' = 'lua'): string[] => candidates(marked, kind).map((candidate) => candidate.label);

/** `label kind group target` for the candidate labelled `label`. */
function candidate(marked: string, label: string): string | undefined {
  const found = candidates(marked).find((candidate) => candidate.label === label);
  if (!found) return undefined;
  const target = found.target;
  let what = '-';
  if (target?.kind === 'local') what = `local ${target.declaration.kind}`;
  else if (target?.kind === 'global') what = `global ${target.site?.kind ?? '-'} ${target.link?.name ?? '-'}`;
  else if (target?.kind === 'library') what = `library ${target.entry.name}`;
  else if (target?.kind === 'engineReplaced') what = `engine ${target.replacement.name}`;
  else if (target?.kind === 'external') what = `external ${target.entry.name}`;
  return `${found.kind} ${String(found.group)} ${what}`;
}

const KEYWORDS_22 = ['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while'];

describe('server/completion/candidates', () => {
  describe('variables', () => {
    it('offers locals, document globals, library globals, EEex globals and keywords, in that order', () => {
      const all = labels('local a = 1 G = 2 |');
      assert.deepEqual(all.slice(0, 2), ['a', 'G']);
      assert.ok(all.indexOf('print') > all.indexOf('G'));
      assert.ok(all.indexOf('EEex_AIBase_GetScriptLevel') > all.indexOf('bit32'));
      assert.ok(all.indexOf('Infinity_DisplayString') > all.indexOf('print'));
      assert.deepEqual(all.slice(-22), KEYWORDS_22);
      assert.equal(candidate('local a = 1 G = 2 |', 'a'), 'variable 0 local local');
      assert.equal(candidate('local a = 1 G = 2 |', 'G'), 'variable 1 global assignment -');
      assert.equal(candidate('|', 'string'), 'module 2 library string');
      assert.equal(candidate('|', '_VERSION'), 'variable 2 library _VERSION');
      assert.equal(candidate('|', 'pairs'), 'function 2 library pairs');
      assert.equal(candidate('|', 'print'), 'function 2 engine print');
      assert.equal(candidate('|', 'Infinity_DisplayString'), 'function 3 external Infinity_DisplayString');
      assert.equal(candidate('|', 'if'), 'keyword 4 -');
    });

    it('never offers what the engine does not open', () => {
      const all = labels('|');
      for (const name of ['io', 'os', 'package', 'require', 'coroutine', 'module', 'unpack', 'loadstring']) assert.ok(!all.includes(name), name);
    });

    it('offers only the locals visible at the cursor, the innermost of each name', () => {
      assert.equal(candidate('local function f(a) local b = a end |', 'f'), 'function 0 local localFunction');
      assert.equal(candidate('local function f(a) local b = a end |', 'a'), undefined);
      assert.equal(candidate('local function f(a) | end', 'a'), 'variable 0 local parameter');
      assert.equal(candidate('function t:m() | end', 'self'), 'variable 0 local self');
      assert.equal(candidate('local f = function() end |', 'f'), 'function 0 local local');
      assert.equal(candidate('for i = 1, 2 do | end', 'i'), 'variable 0 local forVariable');
      assert.equal(labels('local x = 1 do local x = 2 | end').filter((label) => label === 'x').length, 1);
    });

    it('lets a local hide a global, and a document global hide the library', () => {
      assert.equal(candidate('local string = {} |', 'string'), 'variable 0 local local');
      assert.equal(candidate('function print(x) end |', 'print'), 'function 1 global functionDeclaration -');
      assert.equal(candidate('Infinity_DisplayString = f |', 'Infinity_DisplayString'), 'variable 1 global assignment Infinity_DisplayString');
    });

    it('offers globals assigned in any chunk of a .menu file, and locals of the cursor chunk only', () => {
      const menu = 'menu { name "M" onOpen "local hidden = 1 shared = 2" action "|" }';
      const all = labels(menu, 'menu');
      assert.ok(all.includes('shared'));
      assert.ok(!all.includes('hidden'));
    });

    it('offers only locals and keywords while a local _ENV is visible', () => {
      const all = labels('G = 1 local _ENV = {} local a |');
      assert.deepEqual(all.slice(0, 2).sort(), ['_ENV', 'a']);
      assert.ok(!all.includes('G'));
      assert.ok(!all.includes('print'));
      assert.deepEqual(all.slice(-22), KEYWORDS_22);
    });

    it('offers only expression keywords in a .menu expression', () => {
      const all = labels('menu { name "M" enabled "|" }', 'menu');
      assert.deepEqual(all.filter((label) => KEYWORDS_22.includes(label)), ['and', 'false', 'function', 'nil', 'not', 'or', 'true']);
    });

    it('describes a document global by its first assignment, in document order across .menu chunks', () => {
      assert.equal(candidate('G = 1 function G() end |', 'G'), 'variable 1 global assignment -');
      assert.equal(candidate('function G() end G = 1 |', 'G'), 'function 1 global functionDeclaration -');
      const menu = 'menu { name "M" onOpen "function G() end" action "G = 1 |" }';
      const found = candidates(menu, 'menu').find((c) => c.label === 'G');
      assert.equal(found?.target?.kind === 'global' ? found.target.site?.kind : undefined, 'functionDeclaration');
    });

    it('does not offer globals the document only reads', () => {
      assert.ok(!labels('print(undefinedName) |').includes('undefinedName'));
    });
  });

  describe('members', () => {
    it('offers the manual members of a library module', () => {
      const all = labels('string.|');
      assert.ok(all.includes('format'));
      assert.ok(all.includes('rep'));
      assert.ok(all.every((label) => !label.includes('.')));
      assert.equal(candidate('math.|', 'pi'), 'field 2 library math.pi');
      assert.equal(candidate('math.|', 'floor'), 'function 2 library math.floor');
      assert.deepEqual(labels('_G._G.string.|'), labels('string.|'));
    });

    it('offers the fields the document assigns, and drops library members it defines', () => {
      const all = labels('string.format = f function string.trim() end string.|');
      assert.ok(all.includes('trim'));
      assert.equal(candidate('string.format = f string.|', 'format'), 'field 1 -');
      assert.equal(candidate('t.a = 1 function t:m() end t.|', 'a'), 'field 1 -');
      assert.equal(candidate('t.a = 1 function t:m() end t:|', 'm'), 'method 1 -');
    });

    it('offers no library members of a module table the document assigns', () => {
      assert.deepEqual(labels('string = {} string.x = 1 string.|'), ['x']);
    });

    it('offers EEex-Docs members after the operator they are documented with', () => {
      assert.equal(candidate('C:|', 'AddGold'), 'method 3 external C:AddGold');
      assert.ok(!labels('C.|').includes('AddGold'));
      assert.deepEqual(labels('EEex_Options_Option.|'), ['new']);
    });

    it('offers the globals after _G.', () => {
      const all = labels('G = 1 local l = 2 _G.|');
      assert.ok(all.includes('G'));
      assert.ok(all.includes('print'));
      assert.ok(!all.includes('l'));
      assert.ok(!all.includes('if'));
    });

    it('offers nothing on locals and fields of a local _ENV', () => {
      assert.deepEqual(labels('local string = {} string.|'), []);
      assert.deepEqual(labels('local _ENV = {} string.|'), []);
      assert.deepEqual(labels('t.|'), []);
    });

    it('offers string library methods on a parenthesized string', () => {
      const all = labels('x = ("x"):|');
      assert.ok(all.includes('rep'));
      assert.equal(candidate('x = ("x"):|', 'rep'), 'method 2 library string.rep');
      assert.equal(candidate('function string:rep() end x = ("x"):|', 'rep'), 'method 1 -');
    });
  });

  describe('documentation', () => {
    it('refers to documentation by source and name, and finds it again', () => {
      const find = (marked: string, label: string): Candidate => {
        const found = candidates(marked).find((candidate) => candidate.label === label);
        assert.ok(found, label);
        return found;
      };
      for (const [marked, label, expected] of [
        ['|', 'pairs', { source: 'manual', name: 'pairs' }],
        ['string.|', 'format', { source: 'manual', name: 'string.format' }],
        ['|', 'print', { source: 'engineReplaced', name: 'print' }],
        ['C:|', 'AddGold', { source: 'external', name: 'C:AddGold' }],
        ['Infinity_DisplayString = f |', 'Infinity_DisplayString', { source: 'external', name: 'Infinity_DisplayString' }],
      ] as const) {
        const source = documentationSource(find(marked, label).target);
        assert.deepEqual(source, expected);
        assert.ok(documentationTarget(JSON.parse(JSON.stringify(source)) as unknown), label);
      }
      assert.equal(documentationSource(find('local a = 1 |', 'a').target), undefined);
      assert.equal(documentationSource(find('|', 'if').target), undefined);
    });

    it('ignores data it did not produce', () => {
      for (const value of [undefined, null, 1, 'pairs', {}, { source: 'manual' }, { source: 'manual', name: 'io.open' }, { source: 'file', name: 'pairs' }, { source: 'external', name: 'pairs' }]) {
        assert.equal(documentationTarget(value), undefined, JSON.stringify(value));
      }
    });
  });
});
