// What the workspace index keeps for each Lua and .menu file, computed from one
// parse of its text: the outline for `workspace/symbol`, and where it names each
// global shared with other files, for go to definition and find references.
import type { Position, Range, SymbolInformation } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseDocument, type ParsedDocument } from '../syntax/document.ts';
import { globalOccurrences } from '../syntax/navigation.ts';
import { documentKind } from '../validation/validateText.ts';
import { outlineSymbols } from './workspaceSymbols.ts';

/** Where a file names a global. */
export interface GlobalLocation {
  readonly range: Range;
  /** Whether it assigns the global (`x = …`, `function x()`). */
  readonly isWrite: boolean;
}

export interface IndexedFileFacts {
  readonly symbols: readonly SymbolInformation[];
  /** The globals the file names, by name, each list in document order (see `globalOccurrences`). */
  readonly globals: ReadonlyMap<string, readonly GlobalLocation[]>;
}

/** The shared globals of a parsed document, with LSP positions. */
export function globalLocations(parsed: ParsedDocument, positionAt: (offset: number) => Position): Map<string, GlobalLocation[]> {
  const result = new Map<string, GlobalLocation[]>();
  for (const [name, occurrences] of globalOccurrences(parsed)) {
    result.set(
      name,
      occurrences.map(({ start, end, isWrite }) => ({ range: { start: positionAt(start), end: positionAt(end) }, isWrite })),
    );
  }
  return result;
}

/** The facts of a file that is not open, for the workspace index. */
export function analyzeFile(text: string, uri: string): IndexedFileFacts {
  const document = TextDocument.create(uri, '', 0, text);
  const parsed = parseDocument(text, documentKind(uri, ''));
  const positionAt = (offset: number): Position => document.positionAt(offset);
  return { symbols: outlineSymbols(parsed, { uri, positionAt }), globals: globalLocations(parsed, positionAt) };
}
