import type { Connection, Hover, TextDocuments } from 'vscode-languageserver/node';
import { MarkupKind } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParsedDocumentCache } from '../documentCache.ts';
import { renderHover, type HoverFormat } from '../hover/render.ts';
import { hoverTargetAt } from '../hover/resolve.ts';
import type { Messages } from '../l10n.ts';

export interface HoverDeps {
  readonly cache: ParsedDocumentCache;
  readonly format: HoverFormat;
  /** Messages in the client's locale. */
  readonly messages: Messages;
}

/** `textDocument/hover` (see src/server/hover/). */
export function register(connection: Connection, documents: TextDocuments<TextDocument>, deps: HoverDeps): void {
  connection.onHover(({ textDocument, position }, token): Hover | null => {
    try {
      const document = documents.get(textDocument.uri);
      if (!document || token.isCancellationRequested) {
        return null;
      }
      // Synchronous from here on: a cancellation can only arrive after the response.
      const hit = hoverTargetAt(deps.cache.get(document), document.offsetAt(position));
      if (!hit) {
        return null;
      }
      return {
        contents: { kind: deps.format === 'markdown' ? MarkupKind.Markdown : MarkupKind.PlainText, value: renderHover(hit.target, deps.format, deps.messages) },
        range: { start: document.positionAt(hit.identifier.start), end: document.positionAt(hit.identifier.end) },
      };
    } catch (error) {
      connection.console.error(`Hover for ${textDocument.uri} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      return null;
    }
  });
}
