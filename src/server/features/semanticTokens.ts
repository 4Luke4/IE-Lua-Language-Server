import type { Connection, Range, SemanticTokens, SemanticTokensDelta, SemanticTokensLegend, TextDocuments } from 'vscode-languageserver/node';
import { SemanticTokensBuilder } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParsedDocumentCache } from '../documentCache.ts';
import { classifyNames, TOKEN_MODIFIERS, TOKEN_TYPES, type NameToken } from '../semanticTokens/classify.ts';

export interface SemanticTokensDeps {
  readonly cache: ParsedDocumentCache;
}

/** Token types and modifiers by index, as advertised in `semanticTokensProvider.legend`. */
export const LEGEND: SemanticTokensLegend = { tokenTypes: [...TOKEN_TYPES], tokenModifiers: [...TOKEN_MODIFIERS] };

const typeIndex = new Map<string, number>(TOKEN_TYPES.map((type, i) => [type, i]));
const modifierBit = new Map<string, number>(TOKEN_MODIFIERS.map((modifier, i) => [modifier, 1 << i]));

/** Where tokens are pushed: `SemanticTokensBuilder.push`, which delta-encodes them. */
export interface TokenSink {
  push(line: number, char: number, length: number, tokenType: number, tokenModifiers: number): void;
}

/**
 * Pushes the tokens that overlap `range` (`[start, end)` offsets; all when
 * omitted) in the relative format of LSP: line and UTF-16 character of the
 * start, length, legend index of the type and bit set of the modifiers.
 * Tokens never span lines (see classify.ts), so `multilineTokenSupport` is not needed.
 */
export function pushTokens(sink: TokenSink, tokens: readonly NameToken[], positionAt: (offset: number) => { line: number; character: number }, range?: { start: number; end: number }): void {
  for (const token of tokens) {
    if (range && (token.end <= range.start || token.start >= range.end)) continue;
    const { line, character } = positionAt(token.start);
    let modifiers = 0;
    for (const modifier of token.modifiers) modifiers |= modifierBit.get(modifier) ?? 0;
    sink.push(line, character, token.end - token.start, typeIndex.get(token.type) ?? 0, modifiers);
  }
}

/**
 * `textDocument/semanticTokens/full`, `/full/delta` and `/range` (see
 * src/server/semanticTokens/classify.ts). A builder per document keeps the
 * last full result, so a delta request is answered with edits against it.
 */
export function register(connection: Connection, documents: TextDocuments<TextDocument>, deps: SemanticTokensDeps): void {
  const builders = new Map<string, SemanticTokensBuilder>();
  documents.onDidClose(({ document }) => {
    builders.delete(document.uri);
  });
  const empty: SemanticTokens = { data: [] };
  const failed = (uri: string, error: unknown): void => {
    connection.console.error(`Semantic tokens for ${uri} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  };
  /** Pushes the tokens of `document` into `builder`; synchronous, so a cancellation can only arrive after the response. */
  const fill = (builder: TokenSink, document: TextDocument, range?: Range): void => {
    const offsets = range && { start: document.offsetAt(range.start), end: document.offsetAt(range.end) };
    pushTokens(builder, classifyNames(deps.cache.get(document)), (offset) => document.positionAt(offset), offsets);
  };

  connection.languages.semanticTokens.on(({ textDocument }, token): SemanticTokens => {
    try {
      const document = documents.get(textDocument.uri);
      if (!document || token.isCancellationRequested) return empty;
      const builder = new SemanticTokensBuilder();
      builders.set(document.uri, builder);
      fill(builder, document);
      return builder.build();
    } catch (error) {
      builders.delete(textDocument.uri);
      failed(textDocument.uri, error);
      return empty;
    }
  });

  connection.languages.semanticTokens.onDelta(({ textDocument, previousResultId }, token): SemanticTokens | SemanticTokensDelta => {
    try {
      const document = documents.get(textDocument.uri);
      if (!document || token.isCancellationRequested) return empty;
      let builder = builders.get(document.uri);
      if (builder) {
        // Keeps the previous data only when it is the result the client has; otherwise buildEdits() sends a full result.
        builder.previousResult(previousResultId);
      } else {
        builder = new SemanticTokensBuilder();
        builders.set(document.uri, builder);
      }
      fill(builder, document);
      return builder.buildEdits();
    } catch (error) {
      builders.delete(textDocument.uri);
      failed(textDocument.uri, error);
      return empty;
    }
  });

  connection.languages.semanticTokens.onRange(({ textDocument, range }, token): SemanticTokens => {
    try {
      const document = documents.get(textDocument.uri);
      if (!document || token.isCancellationRequested) return empty;
      // A range result has no resultId to diff against later: it does not touch the document's builder.
      const builder = new SemanticTokensBuilder();
      fill(builder, document, range);
      return builder.build();
    } catch (error) {
      failed(textDocument.uri, error);
      return empty;
    }
  });
}
