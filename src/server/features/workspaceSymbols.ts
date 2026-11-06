import type { Connection, Position, SymbolInformation, TextDocuments } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { Runtime } from '../../shared/settings.ts';
import type { ParsedDocumentCache } from '../documentCache.ts';
import type { ParsedDocument } from '../syntax/document.ts';
import { documentSymbols } from '../syntax/symbols.ts';
import { matchesQuery } from '../syntax/workspaceSymbols.ts';
import type { IndexedFile, WorkspaceIndex } from '../workspace/workspaceIndex.ts';
import { untilCancelled } from './cancellation.ts';
import { flatSymbols } from './documentSymbols.ts';
import { openRuntimes, type RuntimeSettings } from './openDocument.ts';
import type { IndexedFileFacts } from './workspaceFiles.ts';

export interface WorkspaceSymbolsDeps {
  readonly cache: ParsedDocumentCache;
  /** `ieLua.runtime.lua` of each open document, which it is parsed for. */
  readonly settings: RuntimeSettings;
  readonly index: Pick<WorkspaceIndex<IndexedFileFacts, Runtime>, 'ready' | 'pathKey' | 'entries'>;
}

/** The flat outline of a parsed document, as `workspace/symbol` lists it. */
export function outlineSymbols(parsed: ParsedDocument, document: { readonly uri: string; positionAt(offset: number): Position }): SymbolInformation[] {
  return flatSymbols(documentSymbols(parsed, parsed.text.length), document);
}

export interface SymbolSource {
  /** Index key (see `WorkspaceIndex.pathKey`), or the URI for a document that is not a local file. */
  readonly key: string;
  readonly symbols: () => readonly SymbolInformation[];
}

/**
 * The symbols matching `query`: those of the open documents, then those of the
 * indexed files that are not open (an open document wins over its saved version).
 * Returns `undefined` once `isCancelled()` turns true.
 */
export function collectWorkspaceSymbols(
  open: readonly SymbolSource[],
  indexed: Iterable<IndexedFile<Pick<IndexedFileFacts, 'symbols'>>>,
  query: string,
  isCancelled: () => boolean,
): SymbolInformation[] | undefined {
  const result: SymbolInformation[] = [];
  const openKeys = new Set(open.map((source) => source.key));
  const add = (symbols: readonly SymbolInformation[]): void => {
    for (const symbol of symbols) if (matchesQuery(symbol.name, query)) result.push(symbol);
  };
  for (const source of open) {
    if (isCancelled()) return undefined;
    add(source.symbols());
  }
  for (const file of indexed) {
    if (isCancelled()) return undefined;
    if (!openKeys.has(file.key)) add(file.value.symbols);
  }
  return result;
}

/**
 * `workspace/symbol` ("Go to Symbol in Workspace"): the outline symbols (see
 * src/server/syntax/symbols.ts) of every Lua and .menu file in the workspace
 * folders, and of every open document.
 */
export function register(connection: Connection, documents: TextDocuments<TextDocument>, deps: WorkspaceSymbolsDeps): void {
  connection.onWorkspaceSymbol(async ({ query }, token): Promise<SymbolInformation[] | null> => {
    try {
      // Files queued for indexing are part of the answer.
      await untilCancelled(deps.index.ready(), token);
      // Read after indexing, so that a document opened meanwhile is included.
      const runtimes = await openRuntimes(documents, deps.settings);
      if (token.isCancellationRequested) return null;
      const open: SymbolSource[] = runtimes.map(({ document, runtime }) => ({
        key: deps.index.pathKey(document.uri) ?? document.uri,
        symbols: () => outlineSymbols(deps.cache.get(document, runtime), document),
      }));
      return collectWorkspaceSymbols(open, deps.index.entries(), query, () => token.isCancellationRequested) ?? null;
    } catch (error) {
      connection.console.error(`Workspace symbols for "${query}" failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      return null;
    }
  });
}
