import type { Connection, Location, TextDocuments } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParsedDocumentCache } from '../documentCache.ts';
import { definitions, targetAt } from '../syntax/navigation.ts';

export interface DefinitionDeps {
  readonly cache: ParsedDocumentCache;
}

/**
 * `textDocument/definition` within the document: the declaration of a local, or
 * every assignment to a global (see src/server/syntax/navigation.ts).
 */
export function register(connection: Connection, documents: TextDocuments<TextDocument>, deps: DefinitionDeps): void {
  connection.onDefinition(({ textDocument, position }, token): Location[] | null => {
    try {
      const document = documents.get(textDocument.uri);
      if (!document || token.isCancellationRequested) {
        return null;
      }
      // Synchronous from here on: a cancellation can only arrive after the response.
      const parsed = deps.cache.get(document);
      const hit = targetAt(parsed, document.offsetAt(position));
      const found = hit ? definitions(parsed, hit.target) : [];
      if (found.length === 0) {
        return null;
      }
      return found.map(({ start, end }) => ({
        uri: document.uri,
        range: { start: document.positionAt(start), end: document.positionAt(end) },
      }));
    } catch (error) {
      connection.console.error(`Definition for ${textDocument.uri} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      return null;
    }
  });
}
