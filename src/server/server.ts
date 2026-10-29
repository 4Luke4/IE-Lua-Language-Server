// IE Lua language server. Runs as its own Node process: VS Code starts it over
// IPC (`--node-ipc`); other editors start it with `--stdio` (see docs/editors/).
// `createConnection` picks the transport from those command-line flags.
import * as path from 'node:path';
import {
  createConnection,
  DidChangeConfigurationNotification,
  DidChangeWatchedFilesNotification,
  FileChangeType,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  WatchKind,
  type SymbolInformation,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParsedDocumentCache } from './documentCache.ts';
import * as definition from './features/definition.ts';
import * as diagnostics from './features/diagnostics.ts';
import * as documentSymbols from './features/documentSymbols.ts';
import * as foldingRanges from './features/foldingRanges.ts';
import * as references from './features/references.ts';
import * as rename from './features/rename.ts';
import * as workspaceSymbols from './features/workspaceSymbols.ts';
import { SettingsStore } from './settingsStore.ts';
import { loadLua52 } from './validation/lua52.ts';
import { nodeFileSystem } from './workspace/nodeFileSystem.ts';
import { WorkspaceIndex } from './workspace/workspaceIndex.ts';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
/** Syntax trees shared by the features, one per open document version. */
const parsed = new ParsedDocumentCache();
documents.onDidClose(({ document }) => {
  parsed.delete(document.uri);
});

const lua = loadLua52();
lua.catch((error: unknown) => {
  connection.console.error(`Loading the Lua 5.2 compiler failed; syntax diagnostics are unavailable: ${String(error)}`);
});

let configurationPull = false;
let watchedFilesRegistration = false;
let workspaceFolderChanges = false;
/** Workspace folder URIs, kept up to date from `workspace/didChangeWorkspaceFolders`. */
let folders: string[] = [];

/** Lua and .menu files of the workspace folders, for workspace symbols. */
const index = new WorkspaceIndex<SymbolInformation[]>({
  fs: nodeFileSystem,
  path,
  analyze: workspaceSymbols.fileSymbols,
  filesExclude: async (folderUri) => {
    if (!configurationPull) return undefined;
    try {
      return (await connection.workspace.getConfiguration({ scopeUri: folderUri, section: 'files.exclude' })) as unknown;
    } catch (error) {
      connection.console.error(`Reading "files.exclude" for ${folderUri} failed: ${String(error)}`);
      return undefined;
    }
  },
  yieldToEventLoop: () => new Promise((resolve) => setImmediate(resolve)),
  log: (message) => {
    connection.console.log(message);
  },
});
// A closed document may have unsaved changes the disk version lacks: index the saved file again.
documents.onDidClose(({ document }) => {
  index.fileChanged(document.uri);
});

connection.onInitialize((params) => {
  const workspace = params.capabilities.workspace;
  configurationPull = workspace?.configuration === true;
  watchedFilesRegistration = workspace?.didChangeWatchedFiles?.dynamicRegistration === true;
  workspaceFolderChanges = workspace?.workspaceFolders === true;
  // Null or absent when no folder is open or the client does not support workspace folders
  // (the deprecated rootUri is not used): then only open documents are searched.
  folders = params.workspaceFolders?.map((folder) => folder.uri) ?? [];
  const diagnosticsFeature = diagnostics.register(connection, documents, {
    lua,
    settings: new SettingsStore(connection, configurationPull, params.initializationOptions),
    timers: { setTimeout, clearTimeout: (handle) => { clearTimeout(handle as NodeJS.Timeout); } },
  });
  documentSymbols.register(connection, documents, {
    cache: parsed,
    hierarchical: params.capabilities.textDocument?.documentSymbol?.hierarchicalDocumentSymbolSupport === true,
  });
  const folding = params.capabilities.textDocument?.foldingRange;
  foldingRanges.register(connection, documents, {
    cache: parsed,
    rangeLimit: folding?.rangeLimit,
    kinds: folding?.foldingRangeKind?.valueSet,
  });
  definition.register(connection, documents, { cache: parsed });
  references.register(connection, documents, { cache: parsed });
  rename.register(connection, documents, { cache: parsed, documentChanges: workspace?.workspaceEdit?.documentChanges === true });
  workspaceSymbols.register(connection, documents, { cache: parsed, index });
  // One handler per notification: settings changes go to every feature that needs them.
  connection.onDidChangeConfiguration(({ settings }) => {
    diagnosticsFeature.configurationChanged(settings);
    index.settingsChanged();
  });
  const prepareRename = params.capabilities.textDocument?.rename?.prepareSupport === true;
  return {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
        save: { includeText: false },
      },
      documentSymbolProvider: { label: 'IE Lua' },
      foldingRangeProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      // Without prepareSupport the client must not be sent `prepareProvider` (LSP 3.17).
      renameProvider: prepareRename ? { prepareProvider: true } : true,
      workspaceSymbolProvider: true,
      ...(workspaceFolderChanges ? { workspace: { workspaceFolders: { supported: true, changeNotifications: true } } } : {}),
    },
    serverInfo: { name: 'IE Lua Language Server' },
  };
});

connection.onInitialized(() => {
  if (configurationPull) {
    // Ask the client to notify us when settings change, so cached values are dropped.
    connection.client.register(DidChangeConfigurationNotification.type, undefined).catch((error: unknown) => {
      connection.console.warn(`Could not register for configuration changes: ${String(error)}`);
    });
  }
  if (watchedFilesRegistration) {
    // LSP glob patterns are case-sensitive; `[]` ranges match the extensions in any letter case.
    // `**/*` (create and delete only) reports folders moved in or deleted, whose files get no events.
    const watchers = [
      { globPattern: '**/*.[lL][uU][aA]' },
      { globPattern: '**/*.[mM][eE][nN][uU]' },
      { globPattern: '**/*', kind: WatchKind.Create | WatchKind.Delete },
    ];
    connection.client.register(DidChangeWatchedFilesNotification.type, { watchers }).catch((error: unknown) => {
      connection.console.warn(`Could not register file watchers; files changed outside the editor are indexed again only on restart: ${String(error)}`);
    });
  }
  if (workspaceFolderChanges) {
    connection.workspace.onDidChangeWorkspaceFolders(({ added, removed }) => {
      const gone = new Set(removed.map((folder) => folder.uri));
      folders = [...folders.filter((uri) => !gone.has(uri)), ...added.map((folder) => folder.uri)];
      index.setFolders(folders);
    });
  }
  // Requests to the client (files.exclude) are allowed only after `initialized`.
  index.setFolders(folders);
});

connection.onDidChangeWatchedFiles(({ changes }) => {
  // Both watchers can report the same file: handle each URI once, with its last change.
  const latest = new Map(changes.map((change) => [change.uri, change.type]));
  for (const [uri, type] of latest) {
    if (type === FileChangeType.Deleted) index.fileDeleted(uri);
    else index.fileChanged(uri);
  }
});

documents.listen(connection);
connection.listen();
