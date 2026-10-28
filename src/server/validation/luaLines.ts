/**
 * Splits text into lines the way the Lua 5.2 lexer counts them (llex.c,
 * `inclinenumber`): `\n`, `\r`, `\r\n` and `\n\r` each end exactly one line.
 * Returns the offset where each line starts and where its content ends.
 */
export function luaLineRanges(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\n' || c === '\r') {
      ranges.push({ start, end: i });
      const next = text[i + 1];
      i += (next === '\n' || next === '\r') && next !== c ? 2 : 1;
      start = i;
    } else {
      i++;
    }
  }
  ranges.push({ start, end: text.length });
  return ranges;
}
