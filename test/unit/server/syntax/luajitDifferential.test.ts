// Differential test: with `runtime: 'luajit'` the parser must accept exactly what
// LuaJIT's own lexer and parser (the WebAssembly module of third_party/luajit/)
// accept, for LuaJIT's lexical extensions above all: numerals (lj_lex.c
// `lex_number`, lj_strscan.c) and `\u{XXXX}` escapes (`lex_string`). Inputs are
// the LuaJIT syntax fixtures, every short numeral over the characters the rules
// look at, escapes around every boundary, and deterministic mutations of valid
// seeds. Goto/label semantics are excluded by design (see src/server/syntax/parser.ts).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseChunk } from '../../../../src/server/syntax/parser.ts';
import type { LuaChecker } from '../../../../src/server/validation/checker.ts';
import { loadLuaJit } from '../../../../src/server/validation/luajit.ts';
import { mutations } from './mutations.ts';

/** Fixtures whose only error is a goto/label check, which the parser does not do. */
const GOTO_SEMANTICS = new Set(['duplicate-label.lua', 'jump-into-local.lua', 'undefined-label.lua']);

/** Characters lex_number and lj_strscan_scan treat specially, plus a letter and a digit they do not. */
const NUMERAL_ALPHABET = ['0', '1', '9', '.', 'x', 'X', 'b', 'e', 'p', 'i', 'I', 'l', 'L', 'u', 'U', '+', '-', 'f', 'g'];

/** Every numeral of up to four characters starting as lex_number is entered (a digit, or `.` and a digit). */
function shortNumerals(): string[] {
  const result: string[] = [];
  const extend = (prefix: string, length: number): void => {
    result.push(prefix);
    if (length === 0) return;
    for (const c of NUMERAL_ALPHABET) extend(prefix + c, length - 1);
  };
  for (const first of ['0', '1', '.0', '.5']) extend(first, 3);
  return result;
}

const LONG_NUMERALS = [
  '18446744073709551615ULL', '18446744073709551616ULL', '18446744073709551615LL', '000018446744073709551615LL', '9223372036854775807LL', '99999999999999999999LL',
  '0xFFFFFFFFFFFFFFFFULL', '0x10000000000000000ULL', '0x0000000000000000FFFFFFFFFFFFFFFFLL', `0x${'f'.repeat(40)}`, `0x${'f'.repeat(40)}i`,
  `0b${'1'.repeat(64)}`, `0b${'1'.repeat(65)}`, `0b0${'1'.repeat(64)}LL`, `0b${'1'.repeat(65)}i`, '0b102', '0b1.1',
  '1e1048575', '1e1048576', '1e01048576', '1e-1048575', '1e-1048576', '0x1p1048576', `0.${'1'.repeat(1048575)}`, `0.${'1'.repeat(1048576)}`, `1.${'0'.repeat(1048576)}`,
  '1.5e3i', '0x1.8p4I', '0x.8i', '3.LL', '1é', '1_000', '1LL.5', '0x1LLp2',
];

const ESCAPES = [
  '\\u{0}', '\\u{41}', '\\u{7F}', '\\u{80}', '\\u{7FF}', '\\u{800}', '\\u{D7FF}', '\\u{D800}', '\\u{DBFF}', '\\u{DC00}', '\\u{DFFF}', '\\u{E000}',
  '\\u{FFFF}', '\\u{10000}', '\\u{10FFFF}', '\\u{110000}', '\\u{1FFFFF}', '\\u{FFFFFFFF}', '\\u{00000000000041}', '\\u{0000000000110000}',
  '\\u{}', '\\u{g}', '\\u{4g}', '\\u{41', '\\u41', '\\u', '\\u{ 41}', '\\u{41 }', '\\U{41}', '\\u{a}\\u{B}', '\\x41\\u{42}\\65',
];

/** Valid LuaJIT seeds for the mutations, with its literals among Lua 5.2 statements and expressions. */
const SEEDS = [
  `local a, b, c = 1LL, 0x10ULL, 18446744073709551615ULL
local z = 3i + 2.5I * 0x1p4i - .5i
for i = 0b1, 0b1011 do
  if i % 2LL == 0 then a = a + i elseif z then b = -b else c = c * 2ULL end
end`,
  `local s = "\\u{48}\\u{20AC}" .. '\\u{10FFFF}' .. "\\x41\\65\\z
     tail"
t = { 0b101, [1LL] = s, n = 0xFFi; f = function(...) return select('#', ...), 7LLU end }
return t.f(1e3i, 0x1.8p-2)`,
];

describe('server/syntax/parser with runtime luajit agrees with LuaJIT', () => {
  let luajit: LuaChecker;
  before(async () => {
    luajit = await loadLuaJit();
  });

  const agree = (source: string): void => {
    const official = luajit.check(source);
    const ours = parseChunk(source, { runtime: 'luajit' }).errors;
    assert.equal(ours.length === 0, official === undefined, `${JSON.stringify(source.length > 200 ? `${source.slice(0, 200)}…` : source)}\n  LuaJIT: ${official ?? 'accepted'}\n  parser: ${JSON.stringify(ours)}`);
  };

  it('on the LuaJIT syntax fixtures', () => {
    const fixtures = join(import.meta.dirname, '../../../fixtures/luajit-syntax');
    const names = readdirSync(fixtures).filter((name) => name.endsWith('.lua') && !GOTO_SEMANTICS.has(name));
    assert.ok(names.includes('literals.lua'));
    for (const name of names) agree(readFileSync(join(fixtures, name), 'utf8'));
  });

  it('on every short numeral, as a value and before an operator', () => {
    const numerals = shortNumerals();
    let rejected = 0;
    for (const numeral of numerals) {
      agree(`x = ${numeral}`);
      agree(`x = ${numeral}+1`);
      if (luajit.check(`x = ${numeral}`) !== undefined) rejected++;
    }
    // Both outcomes must be common for the enumeration to mean anything.
    assert.ok(rejected > 1000 && numerals.length - rejected > 1000, `${rejected} of ${numerals.length} rejected`);
  });

  it('on long numerals at the 64-bit, digit and exponent limits', () => {
    for (const numeral of LONG_NUMERALS) agree(`x = ${numeral}`);
  });

  it('on escapes around every \\u{…} boundary', () => {
    for (const escape of ESCAPES) {
      agree(`x = "${escape}"`);
      agree(`x = '${escape}' .. 1`);
    }
  });

  it('on every seed', () => {
    for (const seed of SEEDS) {
      assert.equal(luajit.check(seed), undefined, seed);
      agree(seed);
    }
  });

  it('on 800 deterministic token mutations of the seeds', () => {
    let rejected = 0;
    SEEDS.forEach((seed, index) => {
      for (const mutant of mutations(seed, 400, index + 1, 'luajit')) {
        agree(mutant);
        if (luajit.check(mutant) !== undefined) rejected++;
      }
    });
    assert.ok(rejected > 200, `only ${rejected} mutants were invalid`);
  });
});
