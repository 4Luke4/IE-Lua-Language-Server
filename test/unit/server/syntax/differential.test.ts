// Differential test: the parser must accept exactly what the official Lua 5.2.4
// compiler (the embedded WebAssembly module) accepts. Inputs are a fixed corpus
// plus deterministic mutations of valid seeds. Goto/label semantics are excluded
// by design (see src/server/syntax/parser.ts), so no input contains `goto` or `::`.
import assert from 'node:assert/strict';
import { lex } from '../../../../src/server/syntax/lexer.ts';
import { parseChunk } from '../../../../src/server/syntax/parser.ts';
import { loadLua52, type Lua52Checker } from '../../../../src/server/validation/lua52.ts';

const CORPUS = [
  // Accepted
  'x = 1', '(a).b = 1', 'f()', 'f"x"', 'f[[x]]', 'f{1}', 'a:b"x"', 'local a = f\n(g)()',
  'return', 'return;', 'return 1;', 'do return end', 'while true do break end',
  'local function f(...) return ... end', 'return ...', 'for i = 1, 2 do end', 'for a, b, c in x do end',
  'x = 0x1p4', 'x = 0x.8', 'x = 3.', 'x = .5', 'x = 1e+5', 'x = 0xA.p1', "x = '\\z  \n  a'", "x = '\\255'",
  'x = [==[ a ]=] ]==]', '--[==x\nx = 1', 'x = a ~= b', 'x = a..b..c', 'x = -2^2', 'x = not a == b',
  't = {1, 2; x = 3, [4] = 5,}', 't = {x}', 'x = function(a, ...) end', 'local x = 1; ;; x = 2',
  'if a then elseif b then else end', 'repeat local x until x', 'x = y z = 1', 'f(g)(h)[1].x = 1',
  'x = a[b][c]:d()', 'function a.b.c:d() end', 'local x, y', 'x = - - 1', 'x = #"s" .. #t',
  // Rejected
  '(a) = 1', 'a.b', 'return 1 x()', 'break', 'function f() break end', 'function f() return ... end',
  'for i do end', 'local a <const> = 1', 'x = 0x', 'x = 1e', 'x = 12abc', 'x = 3..2', "x = '\\x4'",
  "x = '\\256'", "x = '\\q'", 'x = [=a', '--[[ unterminated', 'x = "a\nb"', 'x = ~1', 'x = !a',
  '#!shebang\nx = 1', 'a, b() = 1', 't = {,}', 'x = function(..., a) end', 'x = function(a,) end',
  'a.b:c = 1', 'f() = 1', 'function a:b.c() end', 'local 1 = 2', 'x = a +', 'if a then', 'x = {',
  'x = (1', 'local function() end', 'x = a.1', 'x += 1', 'x = a ? b : c',
];

/** Valid seeds for the mutations: together they use every statement and expression form except goto/labels. */
const SEEDS = [
  `local t = { 1, 2; name = "n", [k .. "x"] = function(a, ...) return select('#', ...) end }
for i = #t, 1, -1 do
  if t[i] == nil then break elseif i % 2 == 0 then t[i] = i ^ 2 else t[i] = -i end
end`,
  `function M.obj:method(a, b)
  local s = self.items[a] or {}
  while not s.done and b > 0 do s, b = s.next, b - 1 end
  repeat local n = s:step() until n >= 10
  return s, (a .. b) ~= "x"
end`,
  `local function f(x) return function(...) return x, ... end end
do local a, b = f(1)(2, 3); print(a, b) end
for k, v in pairs({ a = 1 }) do print(k, v) end`,
  `x = [==[ long
string ]==] .. 'esc\\n\\x41\\65' .. 0x1Fp2 .. 3.5e-1
t.a.b["c"] = g { y = 1 } "s" : m(true, false, nil)`,
];

/** mulberry32: small deterministic PRNG, so every run checks the same inputs. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deletes, duplicates or swaps tokens of `source`. */
function mutations(source: string, count: number, seed: number): string[] {
  const tokens = lex(source).tokens.slice(0, -1);
  const next = random(seed);
  const pick = (): number => Math.floor(next() * tokens.length);
  const result: string[] = [];
  for (let n = 0; n < count; n++) {
    const i = pick();
    const token = tokens[i];
    const other = tokens[pick()];
    if (!token || !other) continue;
    const operation = n % 3;
    if (operation === 0) {
      result.push(source.slice(0, token.start) + source.slice(token.end));
    } else if (operation === 1) {
      result.push(source.slice(0, token.end) + ' ' + source.slice(token.start, token.end) + source.slice(token.end));
    } else {
      const [a, b] = token.start < other.start ? [token, other] : [other, token];
      if (a.end > b.start) continue;
      result.push(source.slice(0, a.start) + source.slice(b.start, b.end) + source.slice(a.end, b.start) + source.slice(a.start, a.end) + source.slice(b.end));
    }
  }
  return result;
}

describe('server/syntax/parser agrees with the official Lua 5.2.4 compiler', () => {
  let lua: Lua52Checker;
  before(async () => {
    lua = await loadLua52();
  });

  const agree = (source: string): void => {
    const official = lua.check(source);
    const ours = parseChunk(source).errors;
    assert.equal(ours.length === 0, official === undefined, `${JSON.stringify(source)}\n  official: ${official ?? 'accepted'}\n  parser: ${JSON.stringify(ours)}`);
  };

  it('on the fixed corpus', () => {
    for (const source of CORPUS) agree(source);
  });

  it('on every seed', () => {
    for (const seed of SEEDS) {
      assert.equal(lua.check(seed), undefined, seed);
      agree(seed);
    }
  });

  it('on 1,600 deterministic token mutations of the seeds', () => {
    let rejected = 0;
    SEEDS.forEach((seed, index) => {
      for (const mutant of mutations(seed, 400, index + 1)) {
        agree(mutant);
        if (lua.check(mutant) !== undefined) rejected++;
      }
    });
    // The mutations must exercise both outcomes to be meaningful.
    assert.ok(rejected > 400, `only ${rejected} mutants were invalid`);
  });
});
