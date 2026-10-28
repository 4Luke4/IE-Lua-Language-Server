// IE Lua language server. Runs as its own Node process: VS Code starts it over
// IPC (`--node-ipc`); other editors start it with `--stdio` (see docs/editors/).
// `createConnection` picks the transport from those command-line flags.
import {
  createConnection,
  DidChangeConfigurationNotification,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParsedDocumentCache } from './documentCache.ts';
import * as diagnostics from './features/diagnostics.ts';
import * as documentSymbols from './features/documentSymbols.ts';
import { SettingsStore } from './settingsStore.ts';
import { loadLua52 } from './validation/lua52.ts';

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

connection.onInitialize((params) => {
  const workspace = params.capabilities.workspace;
  configurationPull = workspace?.configuration === true;
  diagnostics.register(connection, documents, {
    lua,
    settings: new SettingsStore(connection, configurationPull, params.initializationOptions),
    timers: { setTimeout, clearTimeout: (handle) => { clearTimeout(handle as NodeJS.Timeout); } },
  });
  documentSymbols.register(connection, documents, {
    cache: parsed,
    hierarchical: params.capabilities.textDocument?.documentSymbol?.hierarchicalDocumentSymbolSupport === true,
  });
  return {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
        save: { includeText: false },
      },
      documentSymbolProvider: { label: 'IE Lua' },
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
});

documents.listen(connection);
connection.listen();
