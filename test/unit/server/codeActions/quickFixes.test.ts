import assert from 'node:assert/strict';
import {
  analyzeMenu,
  applyChanges,
  applyChecked,
  combineChanges,
  FIXABLE_CODES,
  isFixableCode,
  type MenuFix,
} from '../../../../src/server/codeActions/quickFixes.ts';
import { lexMenu, MAX_WORD_LENGTH } from '../../../../src/server/validation/menuLexer.ts';
import { DiagnosticCode } from '../../../../src/server/validation/types.ts';

/** The text after applying every fix of `text`, or `undefined` when the safety check refuses. */
function fixAll(text: string): string | undefined {
  const analysis = analyzeMenu(text);
  const changes = applyChecked(text, analysis, analysis.fixes);
  return changes && applyChanges(text, changes);
}

/** The text after applying only `fix`. */
function fixOne(text: string, fix: MenuFix | undefined): string | undefined {
  assert.ok(fix, 'no fix');
  const changes = applyChecked(text, analyzeMenu(text), [fix]);
  return changes && applyChanges(text, changes);
}

describe('server/codeActions/quickFixes', () => {
  it('knows exactly the three codes IESDP states a remedy for', () => {
    assert.deepEqual([...FIXABLE_CODES].sort(), ['menu-inline-lua-last-character', 'menu-unquoted-underscore', 'menu-word-too-long']);
    assert.equal(isFixableCode(DiagnosticCode.LuaSyntax), false);
    assert.equal(isFixableCode(DiagnosticCode.MenuUnterminatedString), false);
    assert.equal(isFixableCode(DiagnosticCode.MenuUnterminatedBlock), false);
    assert.equal(isFixableCode(42), false);
  });

  it('quotes a run with "_", so the engine reads it as one string', () => {
    const text = 'menu { name My_Menu }';
    const { fixes } = analyzeMenu(text);
    assert.equal(fixes.length, 1);
    const [fix] = fixes;
    assert.ok(fix);
    assert.equal(fix.problem.code, DiagnosticCode.MenuUnquotedUnderscore);
    assert.equal(fix.action, 'quote');
    assert.equal(fixOne(text, fix), 'menu { name "My_Menu" }');
    assert.deepEqual(lexMenu('menu { name "My_Menu" }').problems, []);
  });

  it('quotes runs that start or end with "_" as written', () => {
    assert.equal(fixAll('text _a b_ __c__'), 'text "_a" "b_" "__c__"');
  });

  it('offers no fix for a run of digits and "_", which is not a name', () => {
    const text = 'area 10_0 0 1 1';
    const analysis = analyzeMenu(text);
    assert.equal(analysis.problems.length, 1);
    assert.deepEqual(analysis.fixes, []);
    assert.equal(applyChecked(text, analysis, analysis.fixes), undefined);
  });

  it('quotes an unquoted word that is too long, as quoted strings are not limited', () => {
    const word = 'a'.repeat(MAX_WORD_LENGTH);
    const text = `text ${word}`;
    const { fixes } = analyzeMenu(text);
    assert.equal(fixes.length, 1);
    assert.equal(fixes[0]?.problem.code, DiagnosticCode.MenuWordTooLong);
    assert.equal(fixOne(text, fixes[0]), `text "${word}"`);
  });

  it('quotes the whole run when a long word is joined to "_", and fixes both problems with one change', () => {
    const word = 'b'.repeat(MAX_WORD_LENGTH + 2);
    const text = `text ${word}_x`;
    const { problems, fixes } = analyzeMenu(text);
    assert.deepEqual(problems.map((p) => p.code), [DiagnosticCode.MenuWordTooLong, DiagnosticCode.MenuUnquotedUnderscore]);
    assert.equal(fixes.length, 2);
    for (const fix of fixes) {
      assert.equal(fixOne(text, fix), `text "${word}_x"`);
    }
    assert.equal(combineChanges(fixes).length, 1);
    assert.equal(fixAll(text), `text "${word}_x"`);
  });

  it('inserts a space before a closing backtick, so the engine drops the space instead of code', () => {
    const text = '`x = 1`\nmenu { name "M" }';
    const { fixes } = analyzeMenu(text);
    assert.equal(fixes.length, 1);
    const [fix] = fixes;
    assert.ok(fix);
    assert.equal(fix.problem.code, DiagnosticCode.MenuInlineLuaLastCharacter);
    assert.equal(fix.action, 'insertSpace');
    assert.deepEqual(fix.change, { start: 6, end: 6, newText: ' ' });
    assert.equal(fixOne(text, fix), '`x = 1 `\nmenu { name "M" }');
  });

  it('keeps the problem range of each fix as the diagnostic has it', () => {
    const text = 'name My_Menu `a=1`';
    const { problems, fixes } = analyzeMenu(text);
    assert.deepEqual(
      fixes.map((fix) => [fix.problem.start, fix.problem.end]),
      problems.map((problem) => [problem.start, problem.end]),
    );
  });

  it('offers no fix for unterminated strings and blocks', () => {
    assert.deepEqual(analyzeMenu('name "open').fixes, []);
    assert.deepEqual(analyzeMenu("name 'open").fixes, []);
    assert.deepEqual(analyzeMenu('`x = 1').fixes, []);
  });

  it('fixes one problem and leaves the others reported at their shifted offsets', () => {
    const text = 'a_b `x=1` c_d';
    const analysis = analyzeMenu(text);
    const first = analysis.fixes[0];
    assert.equal(fixOne(text, first), '"a_b" `x=1` c_d');
    const after = lexMenu('"a_b" `x=1` c_d').problems;
    assert.deepEqual(after.map((p) => p.code), [DiagnosticCode.MenuInlineLuaLastCharacter, DiagnosticCode.MenuUnquotedUnderscore]);
    assert.deepEqual(after.map((p) => p.start), analysis.problems.slice(1).map((p) => p.start + 2));
  });

  it('fixes every fixable problem at once and leaves only those without a fix', () => {
    const text = 'menu {\n\tname My_Menu\n\tarea 10_0 0 1 1\n\tonOpen `x = 1`\n}\n';
    const fixed = 'menu {\n\tname "My_Menu"\n\tarea 10_0 0 1 1\n\tonOpen `x = 1 `\n}\n';
    assert.equal(fixAll(text), fixed);
    assert.deepEqual(lexMenu(fixed).problems.map((p) => p.code), [DiagnosticCode.MenuUnquotedUnderscore]);
    // Idempotent: the result has nothing left to fix.
    assert.deepEqual(analyzeMenu(fixed).fixes, []);
  });

  it('refuses changes after which the remaining problems differ', () => {
    const text = 'a_b c_d';
    const analysis = analyzeMenu(text);
    const first = analysis.fixes[0];
    assert.ok(first);
    // A change that does not match its problem: it would leave `a_b` reported and break `c_d`.
    const bogus: MenuFix = { ...first, change: { start: 5, end: 5, newText: '"' } };
    assert.equal(applyChecked(text, analysis, [bogus]), undefined);
  });

  it('refuses when there is nothing to change', () => {
    const analysis = analyzeMenu('menu { name "M" }');
    assert.equal(applyChecked('menu { name "M" }', analysis, []), undefined);
  });

  it('applies changes in document order and keeps one of overlapping changes, the wider first', () => {
    assert.equal(applyChanges('abcdef', [{ start: 1, end: 2, newText: 'X' }, { start: 4, end: 4, newText: '-' }]), 'aXcd-ef');
    const fix = (start: number, end: number, newText: string): MenuFix => ({
      problem: { start, end, message: '', code: DiagnosticCode.MenuUnquotedUnderscore, severity: 'warning' },
      action: 'quote',
      change: { start, end, newText },
    });
    assert.deepEqual(combineChanges([fix(2, 3, 'n'), fix(0, 5, 'w'), fix(0, 5, 'w'), fix(6, 6, 'i')]), [
      { start: 0, end: 5, newText: 'w' },
      { start: 6, end: 6, newText: 'i' },
    ]);
  });
});
