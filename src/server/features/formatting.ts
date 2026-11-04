import type {
  Connection,
  DocumentSelector,
  FormattingOptions as LspFormattingOptions,
  ServerCapabilities,
  TextDocumentClientCapabilities,
  TextDocuments,
  TextEdit,
} from 'vscode-languageserver/node';
import { DocumentFormattingRequest, DocumentOnTypeFormattingRequest, DocumentRangeFormattingRequest } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { DOCUMENT_SCHEMES } from '../../shared/protocol.ts';
import type { ParsedDocumentCache } from '../documentCache.ts';
import {
  formatDocument,
  formatOnType,
  formatRange,
  ON_TYPE_FIRST_TRIGGER,
  ON_TYPE_MORE_TRIGGERS,
  MAX_TAB_SIZE,
  MIN_TAB_SIZE,
  type FormatResult,
  type FormattingOptions,
} from '../formatting/format.ts';
import type * as Ast from '../syntax/ast.ts';

export interface FormattingDeps {
  readonly cache: ParsedDocumentCache;
}

/**
 * The documents formatting is offered for: Lua files, by language ID (VS Code) or by
 * extension in any letter case (editors with other language IDs). Not .menu files,
 * which are not formatted yet, so VS Code keeps reporting that they have no formatter.
 */
export const LUA_SELECTOR: DocumentSelector = DOCUMENT_SCHEMES.flatMap((scheme) => [
  { language: 'lua', scheme },
  { scheme, pattern: '**/*.[lL][uU][aA]' },
]);

const ON_TYPE_OPTIONS = { firstTriggerCharacter: ON_TYPE_FIRST_TRIGGER, moreTriggerCharacter: [...ON_TYPE_MORE_TRIGGERS] };

/** Which formatting requests the client registers dynamically (with `LUA_SELECTOR`); the others are advertised statically. */
export interface FormattingRegistration {
  readonly document: boolean;
  readonly range: boolean;
  readonly onType: boolean;
}

export function dynamicRegistration(capabilities: TextDocumentClientCapabilities | undefined): FormattingRegistration {
  return {
    document: capabilities?.formatting?.dynamicRegistration === true,
    range: capabilities?.rangeFormatting?.dynamicRegistration === true,
    onType: capabilities?.onTypeFormatting?.dynamicRegistration === true,
  };
}

/**
 * Server capabilities for the requests the client does not register dynamically.
 * A static capability cannot carry a document selector, so these handlers answer
 * `null` for .menu documents.
 */
export function staticCapabilities(dynamic: FormattingRegistration): Pick<
  ServerCapabilities,
  'documentFormattingProvider' | 'documentRangeFormattingProvider' | 'documentOnTypeFormattingProvider'
> {
  return {
    ...(dynamic.document ? {} : { documentFormattingProvider: true }),
    ...(dynamic.range ? {} : { documentRangeFormattingProvider: true }),
    ...(dynamic.onType ? {} : { documentOnTypeFormattingProvider: ON_TYPE_OPTIONS }),
  };
}

/** Registers the dynamically registered requests; call after `initialized`. */
export function registerDynamically(connection: Connection, dynamic: FormattingRegistration): void {
  const failed = (request: string) => (error: unknown) => {
    connection.console.warn(`Could not register ${request}; it is unavailable: ${String(error)}`);
  };
  if (dynamic.document) {
    connection.client.register(DocumentFormattingRequest.type, { documentSelector: LUA_SELECTOR }).catch(failed('document formatting'));
  }
  if (dynamic.range) {
    connection.client.register(DocumentRangeFormattingRequest.type, { documentSelector: LUA_SELECTOR }).catch(failed('range formatting'));
  }
  if (dynamic.onType) {
    connection.client
      .register(DocumentOnTypeFormattingRequest.type, { documentSelector: LUA_SELECTOR, ...ON_TYPE_OPTIONS })
      .catch(failed('on-type formatting'));
  }
}

/** The LSP options the formatter honors; the others (`trimTrailingWhitespace`, …) do not change its result. */
export function formatterOptions(options: LspFormattingOptions): FormattingOptions {
  return {
    tabSize: options.tabSize,
    insertSpaces: options.insertSpaces,
    insertFinalNewline: options.insertFinalNewline,
    trimFinalNewlines: options.trimFinalNewlines,
  };
}

/**
 * What the server logs about a request it did not answer with edits. Refusals of
 * explicit requests are `info`; refusals of on-type requests, sent at every key the
 * user types while the code is incomplete, are `debug`.
 */
export type FormattingLog = (level: 'debug' | 'info' | 'error', message: string) => void;

/**
 * Runs `format` on the Lua chunk of `document` and converts its result to LSP edits.
 * `null` for .menu documents, refused requests and failures, which are logged.
 */
export function formattingEdits(
  document: TextDocument,
  cache: ParsedDocumentCache,
  format: (text: string, tree: Ast.Chunk) => FormatResult,
  log: FormattingLog,
  refusalLevel: 'debug' | 'info' = 'info',
): TextEdit[] | null {
  const parsed = cache.get(document);
  const chunk = parsed.chunks[0];
  if (parsed.kind !== 'lua' || chunk === undefined) return null;
  const result = format(document.getText(), chunk.tree);
  if (!result.ok) {
    if (result.reason === 'syntax-error') {
      log(refusalLevel, `Not formatting ${document.uri}: it has a syntax error before the end of the formatted lines.`);
    } else if (result.reason === 'invalid-options') {
      log('error', `Not formatting ${document.uri}: with insertSpaces, tabSize must be an integer from ${MIN_TAB_SIZE} to ${MAX_TAB_SIZE}.`);
    } else {
      log('error', `Not formatting ${document.uri}: the result would not lex to the same tokens. Please report this with the file.`);
    }
    return null;
  }
  return result.edits.map((edit) => ({
    range: { start: document.positionAt(edit.start), end: document.positionAt(edit.end) },
    newText: edit.newText,
  }));
}

/** `textDocument/formatting`, `/rangeFormatting` and `/onTypeFormatting` (see src/server/formatting/format.ts). */
export function register(connection: Connection, documents: TextDocuments<TextDocument>, deps: FormattingDeps): void {
  const log: FormattingLog = (level, message) => {
    if (level === 'debug') connection.console.debug(message);
    else if (level === 'info') connection.console.info(message);
    else connection.console.error(message);
  };
  /** Shared by the three handlers: synchronous after the lookup, so a cancellation can only arrive after the response. */
  const answer = (
    uri: string,
    cancelled: boolean,
    format: (document: TextDocument, text: string, tree: Ast.Chunk) => FormatResult,
    refusalLevel: 'debug' | 'info' = 'info',
  ): TextEdit[] | null => {
    try {
      const document = documents.get(uri);
      if (!document || cancelled) return null;
      return formattingEdits(document, deps.cache, (text, tree) => format(document, text, tree), log, refusalLevel);
    } catch (error) {
      connection.console.error(`Formatting ${uri} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      return null;
    }
  };

  connection.onDocumentFormatting(({ textDocument, options }, token) =>
    answer(textDocument.uri, token.isCancellationRequested, (_document, text, tree) => formatDocument(text, tree, formatterOptions(options))),
  );
  connection.onDocumentRangeFormatting(({ textDocument, range, options }, token) =>
    answer(textDocument.uri, token.isCancellationRequested, (document, text, tree) =>
      formatRange(text, tree, formatterOptions(options), document.offsetAt(range.start), document.offsetAt(range.end)),
    ),
  );
  connection.onDocumentOnTypeFormatting(({ textDocument, position, ch, options }, token) =>
    answer(
      textDocument.uri,
      token.isCancellationRequested,
      (document, text, tree) => formatOnType(text, tree, formatterOptions(options), document.offsetAt(position), ch),
      'debug',
    ),
  );
}
