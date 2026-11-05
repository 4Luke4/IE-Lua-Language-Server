// What the workspace index keeps for each Lua and .menu file, computed from one
// parse of its text: the outline for `workspace/symbol`, and where it names each
// global shared with other files, for go to definition and find references,
// which look the globals up across files here.
import {
  LSPErrorCodes,
  ResponseError,
  type CancellationToken,
  type Location,
  type Position,
  type Range,
  type SymbolInformation,
  type TextDocuments,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParsedDocumentCache } from '../documentCache.ts';
import { parseDocument, type ParsedDocument } from '../syntax/document.ts';
import { globalOccurrences } from '../syntax/navigation.ts';
import { documentKind } from '../validation/validateText.ts';
import type { IndexedFile, WorkspaceIndex } from '../workspace/workspaceIndex.ts';
import { untilCancelled } from './cancellation.ts';
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

/** The globals of a file other than the one the request is for. */
export interface GlobalSource {
  readonly uri: string;
  /** Index key (see `WorkspaceIndex.pathKey`), or the URI for a document that is not a local file. */
  readonly key: string;
  readonly globals: () => ReadonlyMap<string, readonly GlobalLocation[]>;
}

/**
 * The locations in other files where `keep` accepts a use of the global `name`:
 * first those of the open documents, then those of the indexed files that are
 * not open (an open document wins over its saved version); `current` (the
 * document the request is for, answered from its own text) is skipped. Files
 * come in URI order, each file's locations in document order. Returns
 * `undefined` once `isCancelled()` turns true.
 */
export function collectGlobalLocations(
  name: string,
  keep: (location: GlobalLocation) => boolean,
  currentKey: string,
  open: readonly GlobalSource[],
  indexed: Iterable<IndexedFile<Pick<IndexedFileFacts, 'globals'>>>,
  isCancelled: () => boolean,
): Location[] | undefined {
  const files: { uri: string; locations: readonly GlobalLocation[] }[] = [];
  const seen = new Set<string>([currentKey]);
  const add = (uri: string, globals: ReadonlyMap<string, readonly GlobalLocation[]>): void => {
    const locations = globals.get(name)?.filter(keep);
    if (locations && locations.length > 0) files.push({ uri, locations });
  };
  for (const source of open) {
    if (isCancelled()) return undefined;
    if (seen.has(source.key)) continue;
    seen.add(source.key);
    add(source.uri, source.globals());
  }
  for (const file of indexed) {
    if (isCancelled()) return undefined;
    if (!seen.has(file.key)) add(file.uri, file.value.globals);
  }
  files.sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0));
  return files.flatMap(({ uri, locations }) => locations.map(({ range }) => ({ uri, range })));
}

/** Globals of each open document version, dropped with it (see `ParsedDocumentCache`). */
const openGlobals = new WeakMap<ParsedDocument, Map<string, GlobalLocation[]>>();

export interface CrossFileDeps {
  readonly cache: ParsedDocumentCache;
  readonly index: Pick<WorkspaceIndex<IndexedFileFacts>, 'ready' | 'pathKey' | 'entries'>;
}

/**
 * Where other files use the global `name`, for a request on `document`
 * (`keep` selects the uses). Waits for the files queued for indexing. Resolves
 * to `null` when cancelled, and to a `ContentModified` error when `document`
 * changed meanwhile (LSP 3.17: the result would be computed on a newer text).
 */
export async function otherFileLocations(
  documents: Pick<TextDocuments<TextDocument>, 'get' | 'all'>,
  document: TextDocument,
  name: string,
  keep: (location: GlobalLocation) => boolean,
  deps: CrossFileDeps,
  token: CancellationToken,
): Promise<Location[] | ResponseError | null> {
  const { uri, version } = document;
  await untilCancelled(deps.index.ready(), token);
  if (token.isCancellationRequested) return null;
  if (documents.get(uri)?.version !== version) {
    return new ResponseError(LSPErrorCodes.ContentModified, `${uri} changed while the workspace was being indexed.`);
  }
  const open: GlobalSource[] = documents.all().map((other) => ({
    uri: other.uri,
    key: deps.index.pathKey(other.uri) ?? other.uri,
    globals: () => {
      const parsed = deps.cache.get(other);
      let globals = openGlobals.get(parsed);
      if (!globals) {
        globals = globalLocations(parsed, (offset) => other.positionAt(offset));
        openGlobals.set(parsed, globals);
      }
      return globals;
    },
  }));
  const currentKey = deps.index.pathKey(uri) ?? uri;
  return collectGlobalLocations(name, keep, currentKey, open, deps.index.entries(), () => token.isCancellationRequested) ?? null;
}
