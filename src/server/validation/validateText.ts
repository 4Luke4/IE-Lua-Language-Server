import { luaLineRanges } from './luaLines.ts';
import { parseLuaError } from './luaError.ts';
import { extractMenuLua } from './menuExtractor.ts';
import { DiagnosticCode, type LuaChunk, type Problem } from './types.ts';
import type { Lua52Checker } from './lua52.ts';

/** Prepended to `expression` chunks; contains no line break so line numbers are unchanged. */
export const EXPRESSION_PREFIX = 'return ';

export type DocumentKind = 'lua' | 'menu';

/**
 * Infinity Engine menu files are recognized by the `ie-menu` language ID (VS Code)
 * or by a `.menu` extension in any letter case, so that other editors work whatever
 * they call the file type. Everything else is plain Lua.
 */
export function documentKind(uri: string, languageId: string): DocumentKind {
  if (languageId === 'ie-menu') {
    return 'menu';
  }
  const path = uri.split(/[?#]/, 1)[0] ?? '';
  return /\.menu$/i.test(path) ? 'menu' : 'lua';
}

/**
 * Validates a whole document. Menu documents are split into their Lua chunks
 * first; Lua documents are validated as one chunk.
 */
export function validateText(text: string, kind: DocumentKind, lua: Lua52Checker): Problem[] {
  if (kind === 'lua') {
    return validateChunk({ kind: 'statements', offset: 0, text }, lua);
  }
  const { chunks, problems } = extractMenuLua(text);
  return [...problems, ...chunks.flatMap((chunk) => validateChunk(chunk, lua))];
}

export function validateChunk(chunk: LuaChunk, lua: Lua52Checker): Problem[] {
  const source = chunk.kind === 'expression' ? EXPRESSION_PREFIX + chunk.text : chunk.text;
  const raw = lua.check(source);
  if (raw === undefined) {
    return [];
  }
  const error = parseLuaError(raw);
  const lines = luaLineRanges(chunk.text);
  if (!error) {
    // Unexpected message shape: report it verbatim on the first line of the chunk.
    const first = lines[0] ?? { start: 0, end: 0 };
    return [problem(chunk, first.start, first.end, raw)];
  }
  // `<eof>` errors may name the line after the last one; clamp into the chunk.
  const index = Math.min(Math.max(error.line, 1), lines.length) - 1;
  const line = lines[index] ?? { start: 0, end: chunk.text.length };
  const lineText = chunk.text.slice(line.start, line.end);

  if (error.atEof) {
    const end = chunk.text.length;
    return [problem(chunk, end, end, error.message)];
  }
  if (error.nearToken) {
    // Lua reports only a line. Point at the token when it occurs exactly once on
    // that line; otherwise the location is ambiguous and the whole line is used.
    const first = lineText.indexOf(error.nearToken);
    if (first >= 0 && lineText.indexOf(error.nearToken, first + 1) < 0) {
      const start = line.start + first;
      return [problem(chunk, start, start + error.nearToken.length, error.message)];
    }
  }
  return [problem(chunk, line.start, line.end, error.message)];
}

function problem(chunk: LuaChunk, start: number, end: number, message: string): Problem {
  return {
    start: chunk.offset + start,
    end: chunk.offset + end,
    message,
    code: DiagnosticCode.LuaSyntax,
  };
}
