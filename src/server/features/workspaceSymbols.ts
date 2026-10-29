import type { CancellationToken, Connection, SymbolInformation, TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParsedDocumentCache } from '../documentCache.ts';
import { parseDocument } from '../syntax/document.ts';
import { documentSymbols } from '../syntax/symbols.ts';
import { matchesQuery } from '../syntax/workspaceSymbols.ts';
import { documentKind } from '../validation/validateText.ts';
import type { IndexedFile, WorkspaceIndex } from '../workspace/workspaceIndex.ts';
import { flatSymbols } from './documentSymbols.ts';

export interface WorkspaceSymbolsDeps {
  readonly cache: ParsedDocumentCache;
  readonly index: WorkspaceIndex<SymbolInformation[]>;
}

/** The flat outline of a file that is not open, for the workspace index. */
export function fileSymbols(text: string, uri: string): SymbolInformation[] {
  const document = TextDocument.create(uri, '', 0, text);
  const outline = documentSymbols(parseDocument(text, documentKind(uri, '')), text.length);
  return flatSymbols(outline, { uri, positionAt: (offset) => document.positionAt(offset) });
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
  indexed: Iterable<IndexedFile<SymbolInformation[]>>,
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
    if (!openKeys.has(file.key)) add(file.value);
  }
  return result;
}

/** Resolves when `promise` settles or `token` is cancelled, whichever comes first. */
function untilCancelled(promise: Promise<void>, token: CancellationToken): Promise<void> {
  return new Promise((resolve) => {
    const listener = token.onCancellationRequested(() => {
      listener.dispose();
      resolve();
    });
    void promise.finally(() => {
      listener.dispose();
      resolve();
    });
  });
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
      if (token.isCancellationRequested) return null;
      const open: SymbolSource[] = documents.all().map((document) => ({
        key: deps.index.pathKey(document.uri) ?? document.uri,
        symbols: () =>
          flatSymbols(documentSymbols(deps.cache.get(document), document.getText().length), {
            uri: document.uri,
            positionAt: (offset) => document.positionAt(offset),
          }),
      }));
      return collectWorkspaceSymbols(open, deps.index.entries(), query, () => token.isCancellationRequested) ?? null;
    } catch (error) {
      connection.console.error(`Workspace symbols for "${query}" failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      return null;
    }
  });
}
