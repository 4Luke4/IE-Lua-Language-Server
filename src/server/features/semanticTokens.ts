import type { Connection, Range, SemanticTokens, SemanticTokensDelta, SemanticTokensLegend, TextDocuments } from 'vscode-languageserver/node';
import { SemanticTokensBuilder } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParsedDocumentCache } from '../documentCache.ts';
import { library, type Library } from '../hover/knowledge.ts';
import type { SettingsStore } from '../settingsStore.ts';
import { classifyNames, TOKEN_MODIFIERS, TOKEN_TYPES, type NameToken, type TokenModifier, type TokenType } from '../semanticTokens/classify.ts';

export interface SemanticTokensDeps {
  readonly cache: ParsedDocumentCache;
  /** `ieLua.runtime.lua` decides which names are library names. */
  readonly settings: SettingsStore;
}

/** What `register` returns: the server calls it when settings change. */
export interface SemanticTokensFeature {
  /**
   * Settings changed: the runtime may have changed what every name is, so a client that
   * supports it (`workspace.semanticTokens.refreshSupport`) is asked to request the tokens again.
   */
  configurationChanged(): void;
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
export function register(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  deps: SemanticTokensDeps,
  refreshSupport: boolean,
): SemanticTokensFeature {
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
  const filler = (document: TextDocument, classifier: Library, range?: Range) => (sink: TokenSink): void => {
    const offsets = range && { start: document.offsetAt(range.start), end: document.offsetAt(range.end) };
    pushTokens(sink, classifyNames(deps.cache.get(document), classifier), (offset) => document.positionAt(offset), offsets);
  };
  /**
   * The open document and the library of its runtime, read before the synchronous part of
   * a request; `undefined` when the document is gone or the request was cancelled meanwhile.
   */
  const prepare = async (uri: string, cancelled: () => boolean): Promise<{ document: TextDocument; classifier: Library } | undefined> => {
    if (!documents.get(uri) || cancelled()) return undefined;
    const { runtime } = await deps.settings.get(uri);
    const document = documents.get(uri);
    return document && !cancelled() ? { document, classifier: library(runtime.lua) } : undefined;
  };

  connection.languages.semanticTokens.on(async ({ textDocument }, token): Promise<SemanticTokens> => {
    try {
      const ready = await prepare(textDocument.uri, () => token.isCancellationRequested);
      if (!ready) return { data: [] };
      return results.full(ready.document.uri, filler(ready.document, ready.classifier));
    } catch (error) {
      return failed(textDocument.uri, error);
    }
  });

  connection.languages.semanticTokens.onDelta(async ({ textDocument, previousResultId }, token): Promise<SemanticTokens | SemanticTokensDelta> => {
    try {
      const ready = await prepare(textDocument.uri, () => token.isCancellationRequested);
      if (!ready) return { data: [] };
      return results.delta(ready.document.uri, previousResultId, filler(ready.document, ready.classifier));
    } catch (error) {
      return failed(textDocument.uri, error);
    }
  });

  connection.languages.semanticTokens.onRange(async ({ textDocument, range }, token): Promise<SemanticTokens> => {
    try {
      const ready = await prepare(textDocument.uri, () => token.isCancellationRequested);
      if (!ready) return { data: [] };
      // A range result is never diffed against: it does not touch the document's last result.
      const builder = new SemanticTokensBuilder();
      filler(ready.document, ready.classifier, range)(builder);
      return builder.build();
    } catch (error) {
      return failed(textDocument.uri, error);
    }
  });

  return {
    configurationChanged: () => {
      if (!refreshSupport) return;
      connection.languages.semanticTokens.refresh().catch((error: unknown) => {
        connection.console.warn(`Asking the client to refresh semantic tokens failed: ${String(error)}`);
      });
    },
  };
}
