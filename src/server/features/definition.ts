import type { Connection, Location, ResponseError, TextDocuments } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { definitions, sharedGlobalName, targetAt } from '../syntax/navigation.ts';
import { otherFileLocations, type CrossFileDeps } from './workspaceFiles.ts';

export type DefinitionDeps = CrossFileDeps;

/**
 * `textDocument/definition`: the declaration of a local, or every assignment
 * to a global, first in the document (see src/server/syntax/navigation.ts),
 * then in the other Lua and .menu files of the workspace, which share the
 * engine's global state (see src/server/features/workspaceFiles.ts).
 */
export function register(connection: Connection, documents: TextDocuments<TextDocument>, deps: DefinitionDeps): void {
  connection.onDefinition(async ({ textDocument, position }, token): Promise<Location[] | ResponseError | null> => {
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
      const here: Location[] = definitions(parsed, hit.target).map(({ start, end }) => ({
        uri: document.uri,
        range: { start: document.positionAt(start), end: document.positionAt(end) },
      }));
      const name = sharedGlobalName(hit);
      // Locals belong to this document alone.
      if (name === undefined) {
        return here.length > 0 ? here : null;
      }
      const elsewhere = await otherFileLocations(documents, document, name, (isWrite) => isWrite, deps, token);
      // Cancelled (`null`) or the document changed meanwhile (`ContentModified`).
      if (!Array.isArray(elsewhere)) {
        return elsewhere;
      }
      const all = [...here, ...elsewhere];
      return all.length > 0 ? all : null;
    } catch (error) {
      connection.console.error(`Definition for ${textDocument.uri} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      return null;
    }
  });
}
