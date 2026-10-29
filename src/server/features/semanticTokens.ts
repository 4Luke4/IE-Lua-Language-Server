import type { Connection, Range, SemanticTokens, SemanticTokensDelta, SemanticTokensLegend, TextDocuments } from 'vscode-languageserver/node';
import { SemanticTokensBuilder } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParsedDocumentCache } from '../documentCache.ts';
import { classifyNames, TOKEN_MODIFIERS, TOKEN_TYPES, type NameToken, type TokenModifier, type TokenType } from '../semanticTokens/classify.ts';

export interface SemanticTokensDeps {
  readonly cache: ParsedDocumentCache;
}

/** Token types and modifiers by index, as advertised in `semanticTokensProvider.legend`. */
export const LEGEND: SemanticTokensLegend = { tokenTypes: [...TOKEN_TYPES], tokenModifiers: [...TOKEN_MODIFIERS] };

/** Index of each type, and bit of each modifier, in the legend. */
const TYPE_INDEX = Object.fromEntries(TOKEN_TYPES.map((type, i) => [type, i])) as Readonly<Record<TokenType, number>>;
const MODIFIER_BIT = Object.fromEntries(TOKEN_MODIFIERS.map((modifier, i) => [modifier, 1 << i])) as Readonly<Record<TokenModifier, number>>;

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
    for (const modifier of token.modifiers) modifiers |= MODIFIER_BIT[modifier];
    sink.push(line, character, token.end - token.start, TYPE_INDEX[token.type], modifiers);
  }
}

/**
 * The last full result of each document, so that `/full/delta` can answer
 * with edits against it. `fill` pushes the document's current tokens.
 */
export class TokenResults {
  private readonly builders = new Map<string, SemanticTokensBuilder>();

  /** A full result, remembered for later deltas. */
  full(uri: string, fill: (sink: TokenSink) => void): SemanticTokens {
    const builder = new SemanticTokensBuilder();
    this.builders.set(uri, builder);
    fill(builder);
    return builder.build();
  }

  /**
   * Edits against `previousResultId` when it is the last result of the
   * document; otherwise (unknown id, unseen or closed document) a full result.
   */
  delta(uri: string, previousResultId: string, fill: (sink: TokenSink) => void): SemanticTokens | SemanticTokensDelta {
    const builder = this.builders.get(uri);
    if (!builder) return this.full(uri, fill);
    // Keeps the previous data only when its id matches; buildEdits() then diffs, or else returns a full result.
    builder.previousResult(previousResultId);
    fill(builder);
    return builder.buildEdits();
  }

  delete(uri: string): void {
    this.builders.delete(uri);
  }
}

/**
 * `textDocument/semanticTokens/full`, `/full/delta` and `/range` (see
 * src/server/semanticTokens/classify.ts).
 */
export function register(connection: Connection, documents: TextDocuments<TextDocument>, deps: SemanticTokensDeps): void {
  const results = new TokenResults();
  documents.onDidClose(({ document }) => {
    results.delete(document.uri);
  });
  const failed = (uri: string, error: unknown): SemanticTokens => {
    // A failed request may have left a builder half filled: the next delta starts over.
    results.delete(uri);
    connection.console.error(`Semantic tokens for ${uri} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    return { data: [] };
  };
  /** Pushes the tokens of `document`; synchronous, so a cancellation can only arrive after the response. */
  const filler = (document: TextDocument, range?: Range) => (sink: TokenSink): void => {
    const offsets = range && { start: document.offsetAt(range.start), end: document.offsetAt(range.end) };
    pushTokens(sink, classifyNames(deps.cache.get(document)), (offset) => document.positionAt(offset), offsets);
  };

  connection.languages.semanticTokens.on(({ textDocument }, token): SemanticTokens => {
    try {
      const document = documents.get(textDocument.uri);
      if (!document || token.isCancellationRequested) return { data: [] };
      return results.full(document.uri, filler(document));
    } catch (error) {
      return failed(textDocument.uri, error);
    }
  });

  connection.languages.semanticTokens.onDelta(({ textDocument, previousResultId }, token): SemanticTokens | SemanticTokensDelta => {
    try {
      const document = documents.get(textDocument.uri);
      if (!document || token.isCancellationRequested) return { data: [] };
      return results.delta(document.uri, previousResultId, filler(document));
    } catch (error) {
      return failed(textDocument.uri, error);
    }
  });

  connection.languages.semanticTokens.onRange(({ textDocument, range }, token): SemanticTokens => {
    try {
      const document = documents.get(textDocument.uri);
      if (!document || token.isCancellationRequested) return { data: [] };
      // A range result is never diffed against: it does not touch the document's last result.
      const builder = new SemanticTokensBuilder();
      filler(document, range)(builder);
      return builder.build();
    } catch (error) {
      return failed(textDocument.uri, error);
    }
  });
}
