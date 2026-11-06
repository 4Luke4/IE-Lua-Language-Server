// Deterministic token mutations of valid seeds, for the differential tests of the
// parser against the official compilers (differential.test.ts, luajitDifferential.test.ts).
import { lex } from '../../../../src/server/syntax/lexer.ts';
import type { Runtime } from '../../../../src/shared/settings.ts';

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

/** Deletes, duplicates or swaps tokens of `source` (lexed with the rules of `runtime`). */
export function mutations(source: string, count: number, seed: number, runtime: Runtime = 'lua52'): string[] {
  const tokens = lex(source, 0, source.length, runtime).tokens.slice(0, -1);
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
