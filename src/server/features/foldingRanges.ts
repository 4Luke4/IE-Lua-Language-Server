import type { Connection, FoldingRange, TextDocuments } from 'vscode-languageserver/node';
import { FoldingRangeKind } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParsedDocumentCache } from '../documentCache.ts';
import { foldingRanges, type Fold } from '../syntax/folding.ts';

export interface FoldingClientOptions {
  /** `textDocument.foldingRange.rangeLimit` of the client: a hint, honored by keeping the first ranges. */
  readonly rangeLimit: number | undefined;
  /** `textDocument.foldingRange.foldingRangeKind.valueSet`; kinds outside it are omitted. */
  readonly kinds: readonly string[] | undefined;
}

export interface FoldingRangesDeps extends FoldingClientOptions {
  readonly cache: ParsedDocumentCache;
}

/** LSP folding ranges for a client. Ranges are whole lines, so `lineFoldingOnly` clients are served as is. */
export function toLspFoldingRanges(folds: readonly Fold[], options: FoldingClientOptions): FoldingRange[] {
  const commentKind = options.kinds === undefined || options.kinds.includes(FoldingRangeKind.Comment);
  const limited = options.rangeLimit === undefined ? folds : folds.slice(0, Math.max(0, options.rangeLimit));
  return limited.map(({ startLine, endLine, kind }) => ({
    startLine,
    endLine,
    ...(kind === 'comment' && commentKind ? { kind: FoldingRangeKind.Comment } : {}),
  }));
}

/** `textDocument/foldingRange` (see src/server/syntax/folding.ts). */
export function register(connection: Connection, documents: TextDocuments<TextDocument>, deps: FoldingRangesDeps): void {
  connection.onFoldingRanges(({ textDocument }, token): FoldingRange[] | null => {
    try {
      const document = documents.get(textDocument.uri);
      if (!document || token.isCancellationRequested) {
        return null;
      }
      // Synchronous from here on: a cancellation can only arrive after the response.
      const folds = foldingRanges(deps.cache.get(document), document.getText(), (offset) => document.positionAt(offset).line);
      return toLspFoldingRanges(folds, deps);
    } catch (error) {
      connection.console.error(`Folding ranges for ${textDocument.uri} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      return null;
    }
  });
}
