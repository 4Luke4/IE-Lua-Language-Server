// Syntax trees of a whole document: one chunk for a .lua file, one per embedded
// chunk for a .menu file. Pure: no LSP or `vscode` imports.
import { extractMenuLua, type MenuBlock } from '../validation/menuExtractor.ts';
import { CHUNK_FORM, type LuaChunk } from '../validation/types.ts';
import type { DocumentKind } from '../validation/validateText.ts';
import type { Chunk } from './ast.ts';
import { parseChunk } from './parser.ts';
import { analyzeScopes, type ScopeAnalysis } from './scope.ts';

export interface ParsedChunk {
  readonly chunk: LuaChunk;
  readonly tree: Chunk;
  readonly scopes: ScopeAnalysis;
}

export interface ParsedDocument {
  readonly kind: DocumentKind;
  /** Lua chunks in document order. */
  readonly chunks: readonly ParsedChunk[];
  /** `{ … }` blocks of a .menu file; empty for Lua. */
  readonly blocks: readonly MenuBlock[];
}

/** Parses every Lua chunk of a document. Never throws. */
export function parseDocument(text: string, kind: DocumentKind): ParsedDocument {
  const parse = (chunk: LuaChunk): ParsedChunk => {
    const tree = parseChunk(text, {
      from: chunk.offset,
      to: chunk.offset + chunk.text.length,
      mode: chunk.kind,
      // The engine compiles property code as the body of a function (see CompiledForm).
      functionBody: chunk.origin === 'property',
    });
    return { chunk, tree, scopes: analyzeScopes(tree) };
  };
  if (kind === 'lua') {
    return { kind, chunks: [parse({ kind: 'statements', origin: 'file', offset: 0, region: { start: 0, end: text.length }, text, forms: [CHUNK_FORM] })], blocks: [] };
  }
  const { chunks, blocks } = extractMenuLua(text);
  return { kind, chunks: chunks.map(parse), blocks };
}
