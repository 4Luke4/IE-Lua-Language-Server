import { luaLineRanges } from './luaLines.ts';
import { parseLuaError } from './luaError.ts';
import { extractMenuLua } from './menuExtractor.ts';
import { CHUNK_FORM, DiagnosticCode, type CompiledForm, type LuaChunk, type Problem } from './types.ts';
import type { Lua52Checker } from './lua52.ts';

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
    return validateChunk({ kind: 'statements', origin: 'file', offset: 0, region: { start: 0, end: text.length }, text, forms: [CHUNK_FORM] }, lua);
  }
  const { chunks, problems } = extractMenuLua(text);
  return [...problems, ...chunks.flatMap((chunk) => validateChunk(chunk, lua))];
}

/**
 * Compiles the chunk in each of its forms, as the engine does, and reports the
 * first form that fails: one problem per chunk at most.
 */
export function validateChunk(chunk: LuaChunk, lua: Lua52Checker): Problem[] {
  for (const form of chunk.forms) {
    const found = validateForm(chunk, form, lua);
    if (found) return [found];
  }
  return [];
}

function validateForm(chunk: LuaChunk, form: CompiledForm, lua: Lua52Checker): Problem | undefined {
  const source = form.prefix + chunk.text + form.suffix;
  const raw = lua.check(source);
  if (raw === undefined) {
    return undefined;
  }
  // Offsets in `source` → offsets in the chunk text, clamped into it.
  const textStart = form.prefix.length;
  const textEnd = textStart + chunk.text.length;
  const toChunk = (offset: number): number => Math.min(Math.max(offset, textStart), textEnd) - textStart;
  const error = parseLuaError(raw);
  if (!error) {
    // Unexpected message shape: report it verbatim on the first line of the chunk.
    const first = luaLineRanges(chunk.text)[0] ?? { start: 0, end: 0 };
    return problem(chunk, first.start, first.end, raw);
  }
  if (error.atEof) {
    return problem(chunk, chunk.text.length, chunk.text.length, error.message);
  }
  // `<eof>` errors may name the line after the last one; clamp into the source.
  const lines = luaLineRanges(source);
  const index = Math.min(Math.max(error.line, 1), lines.length) - 1;
  const line = lines[index] ?? { start: 0, end: source.length };
  if (error.nearToken) {
    // Lua reports only a line. Point at the token when it occurs exactly once on
    // that line; otherwise the location is ambiguous and the whole line is used.
    // A token in the text the engine adds (`end`, …) maps to the edge of the chunk.
    const lineText = source.slice(line.start, line.end);
    const first = lineText.indexOf(error.nearToken);
    if (first >= 0 && lineText.indexOf(error.nearToken, first + 1) < 0) {
      const start = line.start + first;
      const end = start + error.nearToken.length;
      if (end <= textStart) return problem(chunk, 0, 0, error.message);
      if (start >= textEnd) return problem(chunk, chunk.text.length, chunk.text.length, error.message);
      return problem(chunk, toChunk(start), toChunk(end), error.message);
    }
  }
  return problem(chunk, toChunk(line.start), toChunk(line.end), error.message);
}

function problem(chunk: LuaChunk, start: number, end: number, message: string): Problem {
  return {
    start: chunk.offset + start,
    end: chunk.offset + end,
    message,
    code: DiagnosticCode.LuaSyntax,
    severity: 'error',
  };
}
