import type { Connection, Location, ResponseError, TextDocuments } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { references, sharedGlobalName, targetAt } from '../syntax/navigation.ts';
import { otherFileLocations, type CrossFileDeps } from './workspaceFiles.ts';

export type ReferencesDeps = CrossFileDeps;

/**
 * `textDocument/references`: the uses of a local in the document, or of a
 * global first in the document (see src/server/syntax/navigation.ts), then in
 * the other Lua and .menu files of the workspace, which share the engine's
 * global state (see src/server/features/workspaceFiles.ts).
 * `context.includeDeclaration` decides whether the declaration of a local, or
 * the assignments to a global, are included.
 */
export function register(connection: Connection, documents: TextDocuments<TextDocument>, deps: ReferencesDeps): void {
  connection.onReferences(async ({ textDocument, position, context }, token): Promise<Location[] | ResponseError | null> => {
    try {
      const document = documents.get(textDocument.uri);
      if (!document || token.isCancellationRequested) {
        return null;
      }
      const parsed = deps.cache.get(document);
      const hit = targetAt(parsed, document.offsetAt(position));
      if (!hit) {
        return null;
      }
      const here: Location[] = references(parsed, hit.target, context.includeDeclaration).map(({ start, end }) => ({
        uri: document.uri,
        range: { start: document.positionAt(start), end: document.positionAt(end) },
      }));
      const name = sharedGlobalName(parsed, hit);
      // Locals, `_ENV` and fields of a local `_ENV` belong to this document alone.
      if (name === undefined) {
        return here;
      }
      const keep = context.includeDeclaration ? () => true : (location: { readonly isWrite: boolean }) => !location.isWrite;
      const elsewhere = await otherFileLocations(documents, document, name, keep, deps, token);
      // Cancelled (`null`) or the document changed meanwhile (`ContentModified`).
      if (!Array.isArray(elsewhere)) {
        return elsewhere;
      }
      return [...here, ...elsewhere];
    } catch (error) {
      connection.console.error(`References for ${textDocument.uri} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      return null;
    }
  });
}
