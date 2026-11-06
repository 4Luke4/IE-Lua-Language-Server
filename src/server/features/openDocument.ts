import type { TextDocuments } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { Runtime } from '../../shared/settings.ts';
import type { SettingsStore } from '../settingsStore.ts';

/** Where features read `ieLua.runtime.lua`, whose lexical rules a document is parsed with (see ParsedDocumentCache). */
export type RuntimeSettings = Pick<SettingsStore, 'get'>;

export interface OpenDocument {
  readonly document: TextDocument;
  readonly runtime: Runtime;
}

/**
 * The open document `uri` and its `ieLua.runtime.lua`, read before the synchronous
 * part of a request. The document is looked up again after the settings: it may
 * have changed or closed meanwhile, and is used as it is now. `undefined` when it
 * is not open or `cancelled()` (a function, so that it is read again after `await`).
 */
export async function openDocument(
  documents: Pick<TextDocuments<TextDocument>, 'get'>,
  uri: string,
  settings: RuntimeSettings,
  cancelled: () => boolean,
): Promise<OpenDocument | undefined> {
  if (!documents.get(uri) || cancelled()) return undefined;
  const { runtime } = await settings.get(uri);
  const document = documents.get(uri);
  return document && !cancelled() ? { document, runtime: runtime.lua } : undefined;
}

/**
 * The open documents with their `ieLua.runtime.lua`, those still open once the
 * settings are read, as they are then. A document opened meanwhile is left out
 * (its saved version, if any, is in the index).
 */
export async function openRuntimes(documents: Pick<TextDocuments<TextDocument>, 'get' | 'all'>, settings: RuntimeSettings): Promise<OpenDocument[]> {
  const uris = documents.all().map((document) => document.uri);
  const runtimes = await Promise.all(uris.map(async (uri) => (await settings.get(uri)).runtime.lua));
  return uris.flatMap((uri, i) => {
    const document = documents.get(uri);
    const runtime = runtimes[i];
    return document && runtime ? [{ document, runtime }] : [];
  });
}
