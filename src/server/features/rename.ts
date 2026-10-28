import type { Connection, PrepareRenameResult, TextDocuments, TextEdit, WorkspaceEdit } from 'vscode-languageserver/node';
import { LSPErrorCodes, ResponseError } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { RENAME_REFUSAL_MESSAGES, type RenameRefusal } from '../../shared/protocol.ts';
import type { ParsedDocumentCache } from '../documentCache.ts';
import { prepareRename, rename } from '../syntax/rename.ts';

export interface RenameDeps {
  readonly cache: ParsedDocumentCache;
  /** `workspace.workspaceEdit.documentChanges` of the client: send versioned edits. */
  readonly documentChanges: boolean;
}

/** A refusal as an LSP error (see RENAME_REFUSAL_MESSAGES). */
export function refusalError(refusal: RenameRefusal): ResponseError {
  return new ResponseError(LSPErrorCodes.RequestFailed, RENAME_REFUSAL_MESSAGES[refusal]);
}

/** The edits of one document as a WorkspaceEdit, versioned when the client supports it. */
export function toWorkspaceEdit(document: Pick<TextDocument, 'uri' | 'version'>, edits: TextEdit[], documentChanges: boolean): WorkspaceEdit {
  return documentChanges
    ? { documentChanges: [{ textDocument: { uri: document.uri, version: document.version }, edits }] }
    : { changes: { [document.uri]: edits } };
}

/**
 * `textDocument/prepareRename` and `textDocument/rename` within the document
 * (see src/server/syntax/rename.ts for what is renamed and what is refused).
 */
export function register(connection: Connection, documents: TextDocuments<TextDocument>, deps: RenameDeps): void {
  const failed = (what: string, uri: string, error: unknown): null => {
    connection.console.error(`${what} for ${uri} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    return null;
  };

  connection.onPrepareRename(({ textDocument, position }, token): PrepareRenameResult | ResponseError | null => {
    try {
      const document = documents.get(textDocument.uri);
      if (!document || token.isCancellationRequested) {
        return null;
      }
      // Synchronous from here on: a cancellation can only arrive after the response.
      const result = prepareRename(deps.cache.get(document), document.offsetAt(position));
      if (!result.ok) {
        return refusalError(result.refusal);
      }
      const { start, end, name } = result.value;
      return { range: { start: document.positionAt(start), end: document.positionAt(end) }, placeholder: name };
    } catch (error) {
      return failed('Prepare rename', textDocument.uri, error);
    }
  });

  connection.onRenameRequest(({ textDocument, position, newName }, token): WorkspaceEdit | ResponseError | null => {
    try {
      const document = documents.get(textDocument.uri);
      if (!document || token.isCancellationRequested) {
        return null;
      }
      // Synchronous from here on: a cancellation can only arrive after the response.
      const result = rename(deps.cache.get(document), document.getText(), document.offsetAt(position), newName);
      if (!result.ok) {
        return refusalError(result.refusal);
      }
      const edits = result.value.map(({ start, end, newText }) => ({
        range: { start: document.positionAt(start), end: document.positionAt(end) },
        newText,
      }));
      return toWorkspaceEdit(document, edits, deps.documentChanges);
    } catch (error) {
      return failed('Rename', textDocument.uri, error);
    }
  });
}
