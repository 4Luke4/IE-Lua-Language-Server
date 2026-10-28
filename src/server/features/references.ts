import type { Connection, Location, TextDocuments } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParsedDocumentCache } from '../documentCache.ts';
import { references, targetAt } from '../syntax/navigation.ts';

export interface ReferencesDeps {
  readonly cache: ParsedDocumentCache;
}

/**
 * `textDocument/references` within the document (see
 * src/server/syntax/navigation.ts). `context.includeDeclaration` decides whether
 * the declaration of a local, or the assignments to a global, are included.
 */
export function register(connection: Connection, documents: TextDocuments<TextDocument>, deps: ReferencesDeps): void {
  connection.onReferences(({ textDocument, position, context }, token): Location[] | null => {
    try {
      const document = documents.get(textDocument.uri);
      if (!document || token.isCancellationRequested) {
        return null;
      }
      // Synchronous from here on: a cancellation can only arrive after the response.
      const parsed = deps.cache.get(document);
      const hit = targetAt(parsed, document.offsetAt(position));
      if (!hit) {
        return null;
      }
      return references(parsed, hit.target, context.includeDeclaration).map(({ start, end }) => ({
        uri: document.uri,
        range: { start: document.positionAt(start), end: document.positionAt(end) },
      }));
    } catch (error) {
      connection.console.error(`References for ${textDocument.uri} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      return null;
    }
  });
}
