---
paths:
  - "src/server/**/*.ts"
  - "src/client/lsp.ts"
  - "src/shared/**/*.ts"
---

# Language Server Rules

Applies to the language server process and the client code that starts it.

## Process Boundary
- The server is a plain Node process. **No `vscode` import anywhere under `src/server/` or `src/shared/`.**
- Communication only through LSP messages. Custom requests/notifications are declared once in
  `src/shared/protocol.ts` as typed `RequestType` / `NotificationType` constants and imported by both sides.

## Server Setup
- Create the connection with `createConnection(ProposedFeatures.all)` and a `TextDocuments(TextDocument)` manager.
- `onInitialize` returns only the capabilities that have handlers. Use incremental sync
  (`TextDocumentSyncKind.Incremental`) unless there is a documented reason not to.
- Check `params.capabilities` for client support (e.g. `workspace.configuration`, `workspaceFolders`)
  before relying on a feature.

## Handlers
- One feature per file in `src/server/features/`, exporting `register(connection, documents, deps)`.
- Every handler accepts and honors its `CancellationToken`; bail out early on cancellation.
- Pure analysis logic (parsing, symbol tables) lives in modules with no LSP imports, so it can be unit-tested directly.
- Never throw out of a handler. Return `null`/empty results or a `ResponseError` with a proper `ErrorCodes` value.

## Diagnostics
- Validate on open and on change, **debounced** (≈200–300 ms per document) to avoid flooding.
- Clear diagnostics on close: `connection.sendDiagnostics({ uri, diagnostics: [] })`.
- Set `source` to the extension name on every diagnostic; give each a stable `code`.

## Performance
- No blocking work on the event loop longer than ~50 ms; chunk or yield for large files.
- Cache per-document results keyed by `uri` + `version`; drop the entry on close.

## Logging
- Use `connection.console.*` (shows in the client's output channel). Never write to stdout directly — it corrupts the stdio transport if one is ever used.

## Client Side (`src/client/lsp.ts`)
- `ServerOptions`: `run` and `debug` both use `TransportKind.ipc`; `debug` adds `execArgv: ['--nolazy', '--inspect=6009']`.
- `documentSelector` lists every scheme supported (`file`, `untitled`), never just a bare language id.
- Restart the client on relevant configuration changes rather than leaving it in a stale state.
