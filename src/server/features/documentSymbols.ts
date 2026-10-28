import type { Connection, DocumentSymbol, SymbolInformation, TextDocuments } from 'vscode-languageserver/node';
import { SymbolKind } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParsedDocumentCache } from '../documentCache.ts';
import { documentSymbols, type OutlineKind, type OutlineSymbol } from '../syntax/symbols.ts';

export interface DocumentSymbolsDeps {
  readonly cache: ParsedDocumentCache;
  /** `textDocument.documentSymbol.hierarchicalDocumentSymbolSupport` of the client. */
  readonly hierarchical: boolean;
}

const KIND: Readonly<Record<OutlineKind, SymbolKind>> = {
  function: SymbolKind.Function,
  method: SymbolKind.Method,
  variable: SymbolKind.Variable,
  field: SymbolKind.Field,
  namespace: SymbolKind.Namespace,
};

/**
 * `textDocument/documentSymbol`: the outline, breadcrumbs and "Go to Symbol in
 * Editor" (see src/server/syntax/symbols.ts for what is listed). Clients without
 * hierarchical support get a flat list with container names.
 */
export function register(connection: Connection, documents: TextDocuments<TextDocument>, deps: DocumentSymbolsDeps): void {
  connection.onDocumentSymbol(({ textDocument }, token): DocumentSymbol[] | SymbolInformation[] | null => {
    try {
      const document = documents.get(textDocument.uri);
      if (!document || token.isCancellationRequested) {
        return null;
      }
      // Synchronous from here on: a cancellation can only arrive after the response.
      const symbols = documentSymbols(deps.cache.get(document), document.getText().length);
      const range = (start: number, end: number) => ({ start: document.positionAt(start), end: document.positionAt(end) });
      if (deps.hierarchical) {
        const convert = (symbol: OutlineSymbol): DocumentSymbol => ({
          name: symbol.name,
          kind: KIND[symbol.kind],
          ...(symbol.detail === undefined ? {} : { detail: symbol.detail }),
          range: range(symbol.start, symbol.end),
          selectionRange: range(symbol.selectionStart, symbol.selectionEnd),
          children: symbol.children.map(convert),
        });
        return symbols.map(convert);
      }
      const flat: SymbolInformation[] = [];
      const flatten = (symbol: OutlineSymbol, container: string | undefined): void => {
        flat.push({
          name: symbol.name,
          kind: KIND[symbol.kind],
          location: { uri: document.uri, range: range(symbol.start, symbol.end) },
          ...(container === undefined ? {} : { containerName: container }),
        });
        for (const child of symbol.children) flatten(child, symbol.name);
      };
      for (const symbol of symbols) flatten(symbol, undefined);
      return flat;
    } catch (error) {
      connection.console.error(`Document symbols for ${textDocument.uri} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      return null;
    }
  });
}
