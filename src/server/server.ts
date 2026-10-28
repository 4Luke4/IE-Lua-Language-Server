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
import * as definition from './features/definition.ts';
import * as diagnostics from './features/diagnostics.ts';
import * as documentSymbols from './features/documentSymbols.ts';
import * as foldingRanges from './features/foldingRanges.ts';
import * as references from './features/references.ts';
import * as rename from './features/rename.ts';
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
  const folding = params.capabilities.textDocument?.foldingRange;
  foldingRanges.register(connection, documents, {
    cache: parsed,
    rangeLimit: folding?.rangeLimit,
    kinds: folding?.foldingRangeKind?.valueSet,
  });
  definition.register(connection, documents, { cache: parsed });
  references.register(connection, documents, { cache: parsed });
  rename.register(connection, documents, { cache: parsed, documentChanges: workspace?.workspaceEdit?.documentChanges === true });
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
