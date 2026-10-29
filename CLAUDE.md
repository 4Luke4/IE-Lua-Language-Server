# CLAUDE.md — VS Code Extension Project

> Project memory for Claude Code. Read this file fully before making changes.
> Scoped rules live in `.claude/rules/`; reusable workflows live in `.claude/commands/`.

---

## 1. Project Overview

| Item | Value |
|---|---|
| Name | `IE Lua Language Server` |
| Publisher | `infinity-engine-tools` |
| Purpose | Lua 5.2 language support (diagnostics, document and workspace symbols, folding, and same-file definition, references and rename now; more LSP features planned) for Infinity Engine EE `.lua` files and the Lua embedded in `.menu` files, usable from VS Code and other LSP editors |
| Language | TypeScript (strict) |
| Bundler | esbuild (two bundles: client + language server) |
| Minimum VS Code | `^1.91.0` (see `engines.vscode` in `package.json`; required by `vscode-languageclient` ≥ 10) |
| Distribution | Private — packaged as `.vsix`, **never published** to any marketplace |

---

## 2. Repository Layout

```
.
├── src/
│   ├── client/              # Extension host code (runs inside VS Code)
│   │   ├── extension.ts     # activate() / deactivate() — entry point
│   │   ├── commands/        # One file per command
│   │   ├── config.ts        # Typed access to contributes.configuration
│   │   └── lsp.ts           # LanguageClient setup and lifecycle
│   ├── server/              # Language server (separate Node process)
│   │   ├── server.ts        # Connection, capabilities, handlers
│   │   ├── features/        # completion.ts, diagnostics.ts, hover.ts, ...
│   │   ├── syntax/          # Lua 5.2 lexer, parser, scopes, symbols, folding (pure, no LSP imports)
│   │   ├── validation/      # Pure analysis logic (no LSP imports) — unit-tested directly
│   │   └── workspace/       # Workspace index, files.exclude glob matching (fs injected; no LSP)
│   └── shared/              # Types/constants used by BOTH sides — no vscode imports
├── test/
│   ├── unit/                # Pure logic, runs in plain Node (no VS Code)
│   ├── integration/         # Runs inside VS Code via @vscode/test-cli
│   └── fixtures/workspace/  # Original fixtures only — never copy game files
├── third_party/lua52/       # Official Lua 5.2.4 → WASM (reproducible build; dist/ is generated)
├── data/eeex/               # Generated EEex docs index (names + links only; see scripts/eeex-docs/)
├── scripts/                 # Repo tooling in TypeScript (`.mts`, run by Node's type stripping)
├── docs/editors/            # Setup guides for non-VS Code editors
├── dist/                    # esbuild output — generated, never edit
├── esbuild.mjs              # Build script
├── package.json             # Manifest: contributes, activationEvents, scripts
├── .vscodeignore            # Controls what ships in the VSIX
└── .vscode-test.mjs         # Integration test configuration
```

**Hard boundary:** `src/server/**` and `src/shared/**` must never import `vscode`.
The server runs in a separate process where the `vscode` module does not exist.

---

## 3. Commands

| Task | Command |
|---|---|
| Install | `npm ci` |
| Build (dev) | `npm run compile` |
| Watch | `npm run watch` |
| Type-check | `npm run check-types` |
| Lint | `npm run lint` |
| Unit tests | `npm run test:unit` |
| Integration tests | `npm test` |
| Production bundle | `npm run package` |
| Localization check | `npm run check-l10n` |
| Third-party notices | `npm run notices` (after `npm run package`; `-- --check` in CI) |
| Rebuild Lua WASM | `npm run build:wasm` (needs pinned emsdk; see CONTRIBUTING.md) |
| Build VSIX | `npx @vscode/vsce package --no-dependencies --changelog-path docs/CHANGELOG.vsix.md` |

**Definition of done for any change:** `check-types`, `lint` and `test:unit` all pass.
Run integration tests when touching activation, commands, configuration or the LSP wiring.

esbuild does **not** type-check. Always run `npm run check-types` — a green build is not proof of correctness.

---

## 4. Architecture Principles

1. **Lazy activation.** Rely on implicit activation from `contributes` (VS Code ≥ 1.74).
   Add explicit `activationEvents` only when needed (e.g. `onLanguage:<id>`, `workspaceContains:`).
   Never use `"*"`.
2. **Everything is disposable.** Every `register*`, event listener, watcher and client goes into
   `context.subscriptions`. `deactivate()` must return the `LanguageClient.stop()` promise.
3. **Heavy work belongs in the server.** Parsing, indexing and diagnostics run in `src/server/`.
   The client is a thin adapter: commands, UI, configuration, and starting the client.
4. **Thin commands.** Command handlers validate input, call a pure function, and report the result.
   Business logic lives in testable modules with no `vscode` dependency.
5. **Typed configuration.** Read settings only through `src/client/config.ts`. Never call
   `workspace.getConfiguration()` with string literals scattered across the codebase.
6. **Workspace-agnostic.** Support multi-root workspaces, untitled documents, and non-`file:` URIs
   (`vscode-remote:`, `vscode-vfs:`). Use `vscode.Uri` and `workspace.fs`, never raw `fs` paths, in the client.
7. **Respect the user.** No unsolicited notifications. Use the `OutputChannel` (`LogOutputChannel`) for logs,
   status bar or progress for long tasks, and `showErrorMessage` only for actionable errors.

---

## 5. Coding Standards

- `strict: true`; no `any` (use `unknown` + narrowing). No non-null `!` without a comment justifying it.
- ES modules syntax in source; esbuild emits CommonJS (`format: 'cjs'`, `platform: 'node'`).
- `vscode` is always an esbuild **external**. Never bundle it, never add it to `dependencies`.
- `@types/vscode` version must match `engines.vscode` — bump both together, never one alone.
- Prefer `async`/`await`; every promise is awaited or explicitly `void`-ed. Honor `CancellationToken`s.
- Command IDs: `ieLua.<verbCamelCase>`. Setting keys: `ieLua.<area>.<name>`.
- User-facing strings go through `vscode.l10n.t()` (client) — keeps localization possible later.
- No new runtime dependency without stating why in the commit message; check its size impact on the bundle.

---

## 6. Manifest (`package.json`) Rules

- Every command in `contributes.commands` has a `title` and `category`; hide irrelevant ones via
  `contributes.menus.commandPalette` with a `when` clause.
- Every setting has `type`, `default`, `markdownDescription` and, where relevant, `enum` + `enumDescriptions`
  and `scope` (`resource` for per-folder settings).
- Changing a setting key or command ID is a **breaking change** — flag it to the user before doing it.
- Keep `main` pointing at `./dist/client/extension.js`.

---

## 7. Language Server Notes

- Packages: `vscode-languageclient` (client), `vscode-languageserver` + `vscode-languageserver-textdocument` (server).
  Keep their major versions in sync.
- Transport: IPC. Server module path resolved with `context.asAbsolutePath('dist/server/server.js')`.
- Only advertise capabilities that are actually implemented.
- Debug the server with `--inspect=6009` via the `debug` server options.
- Full details: `.claude/rules/language-server.md`.
- **Engine facts come from IESDP** (checked against the 2.6.6.0 and 2.7.3.0 executables), never from guesses:
  [MENU format](https://gibberlings3.github.io/iesdp/file_formats/ie_formats/menu_v1.htm) (lexer, grammar,
  which properties are Lua and the exact text compiled for them: see `src/server/validation/menu*.ts`) and
  [Engine Lua globals](https://gibberlings3.github.io/iesdp/file_formats/ie_formats/lua_globals.htm). The engine's
  Lua state opens only `_G`, `table`, `string`, `bit32`, `math` and `debug` and replaces `print`; `io`, `os` and
  `package` (hence `require`) exist only as test-automation stubs. Hover/completion must not offer them.

---

## 8. Packaging (Private VSIX)

- `package.json` contains `"private": true`. **Never run `vsce publish` or `ovsx publish`.**
- Build with `npm run package` then `npx @vscode/vsce package --no-dependencies --changelog-path docs/CHANGELOG.vsix.md`
  (dependencies are bundled by esbuild; the VSIX ships the user-facing changelog).
- `.vscodeignore` must exclude `src/`, `test/`, `node_modules/`, source maps, and config files.
  Verify with `npx @vscode/vsce ls` before handing over a VSIX.
- Install locally with `code --install-extension <file>.vsix`.
- Releases go through `.github/workflows/release.yml` (see CONTRIBUTING.md › Releases): it computes the version
  (even minor = stable, odd minor = pre-release) and keeps `VERSION`, `package.json`, `CHANGELOG.md` and
  `docs/CHANGELOG.vsix.md` in sync. Add entries under `## [Unreleased]` in both changelogs with each change.

---

## 9. Working Agreement for Claude

- **Plan first** for anything touching more than two files: outline the change, then implement.
- **Read before editing.** Check existing patterns in `src/client/commands/` and `src/server/features/` and match them.
- **Small diffs.** One concern per change. Do not reformat unrelated code.
- **Tests with features.** New logic ships with unit tests; new commands/settings get an integration test.
- **Never** edit `dist/`, `*.vsix`, or `package-lock.json` by hand. Never commit secrets.
- **Ask** before: adding dependencies, raising `engines.vscode`, renaming contributed IDs, or changing the build.
- If a VS Code API's behavior is uncertain, say so and check the official API reference rather than guessing.

---

## 10. References

- API: https://code.visualstudio.com/api/references/vscode-api
- Contribution points: https://code.visualstudio.com/api/references/contribution-points
- LSP guide: https://code.visualstudio.com/api/language-extensions/language-server-extension-guide
- Bundling: https://code.visualstudio.com/api/working-with-extensions/bundling-extension
- Testing: https://code.visualstudio.com/api/working-with-extensions/testing-extension
