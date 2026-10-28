import type { Connection, FoldingRange, TextDocuments } from 'vscode-languageserver/node';
import { FoldingRangeKind } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParsedDocumentCache } from '../documentCache.ts';
import { foldingRanges } from '../syntax/folding.ts';

export interface FoldingRangesDeps {
  readonly cache: ParsedDocumentCache;
  /** `textDocument.foldingRange.rangeLimit` of the client: a hint, honored by keeping the first ranges. */
  readonly rangeLimit: number | undefined;
  /** `textDocument.foldingRange.foldingRangeKind.valueSet`; kinds outside it are omitted. */
  readonly kinds: readonly string[] | undefined;
}

/**
 * `textDocument/foldingRange` (see src/server/syntax/folding.ts). Ranges are whole
 * lines only, so clients with `lineFoldingOnly` are served as is.
 */
export function register(connection: Connection, documents: TextDocuments<TextDocument>, deps: FoldingRangesDeps): void {
  const commentKind = deps.kinds === undefined || deps.kinds.includes(FoldingRangeKind.Comment);
  connection.onFoldingRanges(({ textDocument }, token): FoldingRange[] | null => {
    try {
      const document = documents.get(textDocument.uri);
      if (!document || token.isCancellationRequested) {
        return null;
      }
      // Synchronous from here on: a cancellation can only arrive after the response.
      const text = document.getText();
      const folds = foldingRanges(deps.cache.get(document), text, (offset) => document.positionAt(offset).line);
      const limited = deps.rangeLimit === undefined ? folds : folds.slice(0, deps.rangeLimit);
      return limited.map(({ startLine, endLine, kind }) => ({
        startLine,
        endLine,
        ...(kind === 'comment' && commentKind ? { kind: FoldingRangeKind.Comment } : {}),
      }));
    } catch (error) {
      connection.console.error(`Folding ranges for ${textDocument.uri} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      return null;
    }
  });
}
