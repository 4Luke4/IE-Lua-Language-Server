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
import type { Runtime } from '../../shared/settings.ts';
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
import { formatMenuDocument, formatMenuOnType, formatMenuRange, type MenuFormatResult } from '../formatting/menuFormat.ts';
import type * as Ast from '../syntax/ast.ts';
import type { ParsedDocument } from '../syntax/document.ts';
import { openDocument, type RuntimeSettings } from './openDocument.ts';

export interface FormattingDeps {
  readonly cache: ParsedDocumentCache;
  readonly settings: RuntimeSettings;
}

/**
 * The documents formatting is offered for: Lua and .menu files, by language ID (VS Code)
 * or by extension in any letter case (editors with other language IDs).
 */
export const FORMAT_SELECTOR: DocumentSelector = DOCUMENT_SCHEMES.flatMap((scheme) => [
  { language: 'lua', scheme },
  { scheme, pattern: '**/*.[lL][uU][aA]' },
  { language: 'ie-menu', scheme },
  { scheme, pattern: '**/*.[mM][eE][nN][uU]' },
]);

const ON_TYPE_OPTIONS = { firstTriggerCharacter: ON_TYPE_FIRST_TRIGGER, moreTriggerCharacter: [...ON_TYPE_MORE_TRIGGERS] };

/** Which formatting requests the client registers dynamically (with `FORMAT_SELECTOR`); the others are advertised statically. */
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
 * Server capabilities for the requests the client does not register dynamically. A
 * static capability cannot carry a document selector; every document the server
 * serves is a Lua or .menu document, which are all formatted.
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
    connection.client.register(DocumentFormattingRequest.type, { documentSelector: FORMAT_SELECTOR }).catch(failed('document formatting'));
  }
  if (dynamic.range) {
    connection.client.register(DocumentRangeFormattingRequest.type, { documentSelector: FORMAT_SELECTOR }).catch(failed('range formatting'));
  }
  if (dynamic.onType) {
    connection.client
      .register(DocumentOnTypeFormattingRequest.type, { documentSelector: FORMAT_SELECTOR, ...ON_TYPE_OPTIONS })
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

/** How one request formats each kind of document. */
export interface Formatters {
  /** A Lua file: its only chunk. */
  readonly lua: (text: string, tree: Ast.Chunk) => FormatResult;
  /** A .menu file: its structure and the Lua embedded in it. */
  readonly menu: (parsed: ParsedDocument) => MenuFormatResult;
}

/**
 * Runs the formatter for the kind of `document`, parsed for `runtime`
 * (`ieLua.runtime.lua`), and converts its result to LSP edits.
 * `null` for refused requests and failures, which are logged.
 */
export function formattingEdits(
  document: TextDocument,
  cache: ParsedDocumentCache,
  runtime: Runtime,
  formatters: Formatters,
  log: FormattingLog,
  refusalLevel: 'debug' | 'info' = 'info',
): TextEdit[] | null {
  const parsed = cache.get(document, runtime);
  let result: FormatResult | MenuFormatResult;
  if (parsed.kind === 'lua') {
    const chunk = parsed.chunks[0];
    if (chunk === undefined) return null;
    result = formatters.lua(document.getText(), chunk.tree);
  } else {
    result = formatters.menu(parsed);
  }
  if (!result.ok) {
    if (result.reason === 'syntax-error') {
      log(
        refusalLevel,
        parsed.kind === 'lua'
          ? `Not formatting ${document.uri}: it has a syntax error before the end of the formatted lines.`
          : `Not formatting ${document.uri}: it has an unterminated string or Lua block.`,
      );
    } else if (result.reason === 'invalid-options') {
      log('error', `Not formatting ${document.uri}: with insertSpaces, tabSize must be an integer from ${MIN_TAB_SIZE} to ${MAX_TAB_SIZE}.`);
    } else {
      log('error', `Not formatting ${document.uri}: the result would not lex to the same tokens. Please report this with the file.`);
    }
    return null;
  }
  if ('unformatted' in result && result.unformatted > 0) {
    log(refusalLevel, `Formatting ${document.uri}: ${result.unformatted} Lua chunk(s) with a syntax error left as written.`);
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
  const answer = async (
    uri: string,
    cancelled: () => boolean,
    formatters: (document: TextDocument) => Formatters,
    refusalLevel: 'debug' | 'info' = 'info',
  ): Promise<TextEdit[] | null> => {
    try {
      const open = await openDocument(documents, uri, deps.settings, cancelled);
      if (!open) return null;
      return formattingEdits(open.document, deps.cache, open.runtime, formatters(open.document), log, refusalLevel);
    } catch (error) {
      connection.console.error(`Formatting ${uri} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      return null;
    }
  };

  connection.onDocumentFormatting(({ textDocument, options }, token) => {
    const formatting = formatterOptions(options);
    return answer(textDocument.uri, () => token.isCancellationRequested, () => ({
      lua: (text, tree) => formatDocument(text, tree, formatting),
      menu: (parsed) => formatMenuDocument(parsed, formatting),
    }));
  });
  connection.onDocumentRangeFormatting(({ textDocument, range, options }, token) => {
    const formatting = formatterOptions(options);
    return answer(textDocument.uri, () => token.isCancellationRequested, (document) => {
      const start = document.offsetAt(range.start);
      const end = document.offsetAt(range.end);
      return {
        lua: (text, tree) => formatRange(text, tree, formatting, start, end),
        menu: (parsed) => formatMenuRange(parsed, formatting, start, end),
      };
    });
  });
  connection.onDocumentOnTypeFormatting(({ textDocument, position, ch, options }, token) => {
    const formatting = formatterOptions(options);
    return answer(
      textDocument.uri,
      () => token.isCancellationRequested,
      (document) => {
        const offset = document.offsetAt(position);
        return {
          lua: (text, tree) => formatOnType(text, tree, formatting, offset, ch),
          menu: (parsed) => formatMenuOnType(parsed, formatting, offset, ch),
        };
      },
      'debug',
    );
  });
}
