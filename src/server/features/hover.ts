import type { Connection, Hover, TextDocuments } from 'vscode-languageserver/node';
import { MarkupKind } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParsedDocumentCache } from '../documentCache.ts';
import { library } from '../hover/knowledge.ts';
import { renderHover, type HoverFormat } from '../hover/render.ts';
import { hoverTargetAt } from '../hover/resolve.ts';
import type { Messages } from '../l10n.ts';
import type { SettingsStore } from '../settingsStore.ts';

export interface HoverDeps {
  readonly cache: ParsedDocumentCache;
  /** `ieLua.runtime.lua` decides which libraries are described. */
  readonly settings: SettingsStore;
  readonly format: HoverFormat;
  /** Messages in the client's locale. */
  readonly messages: Messages;
}

/** `textDocument/hover` (see src/server/hover/). */
export function register(connection: Connection, documents: TextDocuments<TextDocument>, deps: HoverDeps): void {
  connection.onHover(async ({ textDocument, position }, token): Promise<Hover | null> => {
    try {
      // A function, so that the check after `await` reads the token again.
      const cancelled = (): boolean => token.isCancellationRequested;
      if (!documents.get(textDocument.uri) || cancelled()) {
        return null;
      }
      const { runtime } = await deps.settings.get(textDocument.uri);
      // The document may have changed or closed meanwhile: use it as it is now. Synchronous from
      // here on, so a cancellation can only arrive after the response.
      const document = documents.get(textDocument.uri);
      if (!document || cancelled()) {
        return null;
      }
      const hit = hoverTargetAt(deps.cache.get(document, runtime.lua), document.offsetAt(position), library(runtime.lua));
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
