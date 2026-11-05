// Quick fixes for text the engine misreads in .menu files. Pure: no LSP or
// `vscode` imports.
//
// Only fixes whose remedy IESDP states are offered ("MENU file format",
// https://gibberlings3.github.io/iesdp/file_formats/ie_formats/menu_v1.htm):
//
// | Code                             | IESDP                                                                     | Fix                                 |
// | -------------------------------- | ------------------------------------------------------------------------- | ----------------------------------- |
// | `menu-unquoted-underscore`       | "Underscores are not part of a word … Always quote names."                | `"…"` around the run                |
// | `menu-word-too-long`             | "A longer unquoted word aborts the game. Quoted strings are not limited." | `"…"` around the word               |
// | `menu-inline-lua-last-character` | "end every inline block with a line break or a space"                     | a space before the closing backtick |
//
// The fixes change the Lua the engine compiles, as intended: the character it
// dropped before a backtick now runs, and a quoted property value is compiled
// whole (`enabled "My_Var"` is `My_Var`, not `My`). The safety check covers the
// .menu lexing only; the Lua is validated as usual.
//
// The other codes have no single correct fix: where an unterminated string or
// block should end, or how to repair a Lua syntax error, would be a guess.
//
// Every set of edits is checked before it is offered (`applyChecked`): the edited
// text is lexed again, and its problems must be exactly the problems the edits do
// not touch.

import { lexMenu } from '../validation/menuLexer.ts';
import { DiagnosticCode, type Problem } from '../validation/types.ts';

/** The diagnostic codes that have a quick fix. */
export const FIXABLE_CODES = [
  DiagnosticCode.MenuUnquotedUnderscore,
  DiagnosticCode.MenuWordTooLong,
  DiagnosticCode.MenuInlineLuaLastCharacter,
] as const;
export type FixableCode = (typeof FIXABLE_CODES)[number];

export function isFixableCode(code: unknown): code is FixableCode {
  return (FIXABLE_CODES as readonly unknown[]).includes(code);
}

/** A replacement of the half-open range `[start, end)` of the text by `newText`. */
export interface TextChange {
  readonly start: number;
  readonly end: number;
  readonly newText: string;
}

/** What a fix does, for its title. */
export type FixAction = 'quote' | 'insertSpace';

/** The fix of one problem. */
export interface MenuFix {
  /** The problem it fixes, with the range its diagnostic has. */
  readonly problem: Problem & { readonly code: FixableCode };
  readonly action: FixAction;
  readonly change: TextChange;
}

/** The problems of a .menu text, as `lexMenu` reports them, and the fixes of those that have one. */
export interface MenuFixAnalysis {
  readonly problems: readonly Problem[];
  readonly fixes: readonly MenuFix[];
}

const LETTER = /[A-Za-z]/;

function quote(text: string, start: number, end: number): TextChange {
  // A run of letters, digits and `_` never contains a quote, so `"…"` holds it as is.
  return { start, end, newText: `"${text.slice(start, end)}"` };
}

function contains(outer: Problem, inner: Problem): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

/**
 * The problems `lexMenu` reports for `text` (the same ones the diagnostics
 * publish, at the same offsets) and a fix for each one that has one:
 *
 * - `menu-unquoted-underscore`: the run in `"…"`, when it has a letter. A run of
 *   digits and `_` (`10_0`) is not a name and gets no fix: quoting would make a
 *   number a string, and what was meant (`100`, `10 0`) is unknown.
 * - `menu-word-too-long`: the word in `"…"`; when the word is part of a run
 *   with `_`, the whole run, since quoting the word alone would leave the rest
 *   of the run misread.
 * - `menu-inline-lua-last-character`: a space inserted before the closing
 *   backtick, so the engine drops the space instead of code.
 */
export function analyzeMenu(text: string): MenuFixAnalysis {
  const { problems } = lexMenu(text);
  const runs = problems.filter((problem) => problem.code === DiagnosticCode.MenuUnquotedUnderscore);
  const fixes: MenuFix[] = [];
  for (const problem of problems) {
    switch (problem.code) {
      case DiagnosticCode.MenuUnquotedUnderscore:
        if (LETTER.test(text.slice(problem.start, problem.end))) {
          fixes.push({ problem: { ...problem, code: problem.code }, action: 'quote', change: quote(text, problem.start, problem.end) });
        }
        break;
      case DiagnosticCode.MenuWordTooLong: {
        const run = runs.find((candidate) => contains(candidate, problem)) ?? problem;
        fixes.push({ problem: { ...problem, code: problem.code }, action: 'quote', change: quote(text, run.start, run.end) });
        break;
      }
      case DiagnosticCode.MenuInlineLuaLastCharacter:
        // The problem is the character before the closing backtick, which is at `end`.
        fixes.push({ problem: { ...problem, code: problem.code }, action: 'insertSpace', change: { start: problem.end, end: problem.end, newText: ' ' } });
        break;
      default:
        break;
    }
  }
  return { problems, fixes };
}

/** The part of the text a fix depends on: its problem and the range it changes. */
function span(fix: MenuFix): { start: number; end: number } {
  return { start: Math.min(fix.problem.start, fix.change.start), end: Math.max(fix.problem.end, fix.change.end) };
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * The changes of several fixes as one set: in document order, each distinct
 * change once (a long word in a run with `_` has the run's change), and a change
 * that overlaps one already kept is dropped, the wider one kept first.
 */
export function combineChanges(fixes: readonly MenuFix[]): TextChange[] {
  const ordered = [...fixes]
    .map((fix) => fix.change)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: TextChange[] = [];
  for (const change of ordered) {
    const last = kept.at(-1);
    if (last && last.start === change.start && last.end === change.end && last.newText === change.newText) continue;
    // Insertions (empty ranges) conflict with a change that covers their position.
    const reach = { start: change.start, end: Math.max(change.end, change.start + 1) };
    if (kept.some((other) => overlaps({ start: other.start, end: Math.max(other.end, other.start + 1) }, reach))) continue;
    kept.push(change);
  }
  return kept;
}

/** `text` with `changes` (in document order, not overlapping) applied. */
export function applyChanges(text: string, changes: readonly TextChange[]): string {
  let result = '';
  let at = 0;
  for (const change of changes) {
    result += text.slice(at, change.start) + change.newText;
    at = change.end;
  }
  return result + text.slice(at);
}

/** Where `offset` of the original text is after `changes`, for an offset outside every changed range. */
function shifted(offset: number, changes: readonly TextChange[]): number {
  let delta = 0;
  for (const change of changes) {
    if (change.end <= offset) delta += change.newText.length - (change.end - change.start);
  }
  return offset + delta;
}

function sameProblem(a: Problem, b: Problem): boolean {
  return a.start === b.start && a.end === b.end && a.code === b.code && a.message === b.message && a.severity === b.severity;
}

/**
 * The changes of `fixes` (`combineChanges`), when they are safe: the edited text
 * must have exactly the problems of the original that no fix touches (its
 * problem and changed range), at their shifted offsets. `undefined` otherwise,
 * or when there is nothing to change.
 */
export function applyChecked(text: string, analysis: MenuFixAnalysis, fixes: readonly MenuFix[]): TextChange[] | undefined {
  const changes = combineChanges(fixes);
  if (changes.length === 0) return undefined;
  // A fix whose change was dropped for an overlap is only fixed if a kept change covers its problem.
  const applied = fixes.filter((fix) => changes.some((change) => change.start === fix.change.start && change.end === fix.change.end && change.newText === fix.change.newText));
  const touched = [...applied.map(span), ...changes.map((change) => ({ start: change.start, end: Math.max(change.end, change.start + 1) }))];
  const expected = analysis.problems
    .filter((problem) => !touched.some((range) => overlaps(range, { start: problem.start, end: Math.max(problem.end, problem.start + 1) })))
    .map((problem) => ({ ...problem, start: shifted(problem.start, changes), end: shifted(problem.end, changes) }));
  const actual = lexMenu(applyChanges(text, changes)).problems;
  const same = actual.length === expected.length && actual.every((problem, index) => {
    const wanted = expected[index];
    return wanted !== undefined && sameProblem(problem, wanted);
  });
  return same ? changes : undefined;
}
