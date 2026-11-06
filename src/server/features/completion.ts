import type { CompletionItem, CompletionList, Connection, MarkupContent, Range, TextDocuments } from 'vscode-languageserver/node';
import { CompletionItemKind, InsertReplaceEdit, MarkupKind, TextEdit } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { completionCandidates, documentationSource, documentationTarget, type Candidate, type CandidateKind } from '../completion/candidates.ts';
import type { ParsedDocumentCache } from '../documentCache.ts';
import { library as libraryOf, LUA52, type Library } from '../hover/knowledge.ts';
import { renderDocumentation, renderSignature, type HoverFormat } from '../hover/render.ts';
import type { HoverTarget } from '../hover/resolve.ts';
import type { Messages } from '../l10n.ts';
import type { SettingsStore } from '../settingsStore.ts';
import { completionSiteAt } from '../syntax/completionContext.ts';

/** What the client supports, from `textDocument.completion` and `completionList` of its capabilities. */
export interface CompletionClientOptions {
  /** Format of `documentation` (see `markupFormat`). */
  readonly format: HoverFormat;
  /** `completionItem.insertReplaceSupport`: edits may give both an insert and a replace range. */
  readonly insertReplace: boolean;
  /** `completionList.itemDefaults` includes `editRange`: the range is sent once for the whole list. */
  readonly defaultEditRange: boolean;
}

export interface CompletionDeps extends CompletionClientOptions {
  readonly cache: ParsedDocumentCache;
  /** `ieLua.runtime.lua` decides which libraries are offered. */
  readonly settings: SettingsStore;
  /** Messages in the client's locale. */
  readonly messages: Messages;
}

/** Characters after which the client asks for completion without being invoked (see syntax/completionContext.ts). */
export const TRIGGER_CHARACTERS: readonly string[] = ['.', ':'];

const ITEM_KINDS: Readonly<Record<CandidateKind, CompletionItemKind>> = {
  function: CompletionItemKind.Function,
  variable: CompletionItemKind.Variable,
  module: CompletionItemKind.Module,
  field: CompletionItemKind.Field,
  method: CompletionItemKind.Method,
  keyword: CompletionItemKind.Keyword,
};

const markup = (value: string, format: HoverFormat): MarkupContent => ({ kind: format === 'markdown' ? MarkupKind.Markdown : MarkupKind.PlainText, value });

/**
 * The documentation of a target documented by a doc comment of the document
 * (docComments/), rendered now: `completionItem/resolve` names no document, and
 * looking the name up again later could find a newer version of it. Only names
 * with a doc comment pay for this.
 */
function documentDocumentation(target: HoverTarget | undefined, format: HoverFormat, messages: Messages): MarkupContent | undefined {
  const documented =
    (target?.kind === 'local' && (target.doc !== undefined || target.param !== undefined)) ||
    (target?.kind === 'global' && target.doc !== undefined) ||
    (target?.kind === 'member' && target.definition.doc !== undefined);
  const value = documented ? renderDocumentation(target, format, messages) : undefined;
  return value === undefined ? undefined : markup(value, format);
}

/**
 * The completion list for candidates. `insert` is the name before the cursor,
 * `replace` the whole name around it; clients without insert/replace support
 * get `insert`, which leaves the text after the cursor as it is.
 */
export function toCompletionList(
  candidates: readonly Candidate[],
  insert: Range,
  replace: Range,
  options: CompletionClientOptions,
  messages: Messages,
  library: Library = LUA52,
): CompletionList {
  const editRange = options.insertReplace ? { insert, replace } : insert;
  const items = candidates.map((candidate): CompletionItem => {
    const documentation = documentDocumentation(candidate.target, options.format, messages);
    // Documentation sent now needs nothing to resolve.
    const data = documentation ? undefined : documentationSource(candidate.target, library);
    let textEdit: TextEdit | InsertReplaceEdit | undefined;
    if (!options.defaultEditRange) {
      textEdit = options.insertReplace ? InsertReplaceEdit.create(candidate.label, insert, replace) : TextEdit.replace(insert, candidate.label);
    }
    return {
      label: candidate.label,
      kind: ITEM_KINDS[candidate.kind],
      sortText: String(candidate.group),
      ...(candidate.target ? { detail: renderSignature(candidate.target, messages) } : {}),
      ...(documentation ? { documentation } : {}),
      ...(data ? { data } : {}),
      ...(textEdit ? { textEdit } : {}),
    };
  });
  return { isIncomplete: false, ...(options.defaultEditRange ? { itemDefaults: { editRange } } : {}), items };
}

/** `item` with its documentation, when its `data` names any. */
export function resolveCompletionItem(item: CompletionItem, format: HoverFormat, messages: Messages): CompletionItem {
  const target = documentationTarget(item.data);
  const documentation = target && renderDocumentation(target, format, messages);
  if (documentation === undefined) return item;
  return { ...item, documentation: markup(documentation, format) };
}

/** `textDocument/completion` and `completionItem/resolve` (see src/server/completion/). */
export function register(connection: Connection, documents: TextDocuments<TextDocument>, deps: CompletionDeps): void {
  connection.onCompletion(async ({ textDocument, position }, token): Promise<CompletionList | null> => {
    try {
      // A function, so that the check after `await` reads the token again.
      const cancelled = (): boolean => token.isCancellationRequested;
      if (!documents.get(textDocument.uri) || cancelled()) {
        return null;
      }
      const library = libraryOf((await deps.settings.get(textDocument.uri)).runtime.lua);
      // The document may have changed or closed meanwhile: use it as it is now. Synchronous from
      // here on, so a cancellation can only arrive after the response.
      const document = documents.get(textDocument.uri);
      if (!document || cancelled()) {
        return null;
      }
      const parsed = deps.cache.get(document);
      const offset = document.offsetAt(position);
      const site = completionSiteAt(parsed, document.getText(), offset);
      if (!site) {
        return null;
      }
      const start = document.positionAt(site.start);
      const insert = { start, end: document.positionAt(offset) };
      return toCompletionList(completionCandidates(parsed, site, library), insert, { start, end: document.positionAt(site.end) }, deps, deps.messages, library);
    } catch (error) {
      connection.console.error(`Completion for ${textDocument.uri} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      return null;
    }
  });
  connection.onCompletionResolve((item, token): CompletionItem => {
    try {
      return token.isCancellationRequested ? item : resolveCompletionItem(item, deps.format, deps.messages);
    } catch (error) {
      connection.console.error(`Resolving the completion item "${item.label}" failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      return item;
    }
  });
}
