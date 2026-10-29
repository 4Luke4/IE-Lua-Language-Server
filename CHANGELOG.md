# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this
project uses [VS Code's extension versioning](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions):
plain `major.minor.patch`, with an **even minor for stable releases** and an **odd minor for
pre-releases**. Versions are computed by the release workflow from
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

This is the detailed, developer-facing changelog. The user-facing release notes shipped inside
the extension live in [`docs/CHANGELOG.vsix.md`](docs/CHANGELOG.vsix.md).

## [Unreleased]

### Added

- Language server (separate Node process; IPC in VS Code, `--stdio` for other editors) with
  syntax diagnostics from the official Lua 5.2.4 compiler, built to WebAssembly from the
  checksum-verified lua.org tarball (`third_party/lua52/`, reproducible build checked in CI).
- `.menu` support: new `ie-menu` language (case-insensitive `.menu` extension), TextMate grammar
  with embedded Lua highlighting, and validation of the Lua the engine compiles, found with a lexer
  that follows the engine's (per [IESDP](https://gibberlings3.github.io/iesdp/file_formats/ie_formats/menu_v1.htm)):
  `` `…` `` blocks; `onOpen`, `onClose` and `action*` scripts; and the expressions of `enabled`,
  `actionDrag`, `table`, `seperator`, `useOverlayTint`, `bitmap res` and every `lua` value. A value
  can be `"…"`, `'…'` or an unquoted word that is not a keyword, anywhere on a line. Each is
  compiled in the shape the engine compiles it: property code as the body of
  `function f () … end` (so `...` and a trailing `--` comment are errors), expressions as its
  `return` value, and `` `…` `` blocks without their last character, which the engine drops.
- Settings `ieLua.validate.mode` (`manual`, `save` (default), `type`, `saveAndType`) and
  `ieLua.validate.debounce` (default 300 ms).
- Command **IE Lua: Validate Current File** (`ieLua.validateDocument`).
- Document symbols (`textDocument/documentSymbol`; outline, breadcrumbs, *Go to Symbol in
  Editor*): functions and methods at any depth, top-level locals, the first assignment to each
  global, and named table fields; in `.menu` files, each `menu` block by its `name`, holding the
  Lua symbols inside it. Flat `SymbolInformation` for clients without hierarchical support.
- Folding ranges (`textDocument/foldingRange`): function bodies, `do`/`while`/`for`/`repeat`,
  each `if`/`elseif`/`else` clause, multi-line tables, call arguments and long strings, long
  comments and runs of `--` lines; in `.menu` files every `{ … }` block, `` `…` `` blocks and
  `"…"` scripts, plus the Lua inside them. The closing line stays visible. Honors the client's
  `rangeLimit` and supported kinds.
- Go to definition (`textDocument/definition`) within the document: from any use of a local to
  its declaration, and from a global to every assignment to it (`x = …`, `function x()`). In
  `.menu` files globals are shared by all Lua chunks, locals stay in their own chunk. No result
  for the implicit `self`, for globals the document never assigns, or for table fields.
- Find references (`textDocument/references`) within the document, with the same matching as
  go to definition: the uses of a local, including the implicit `self` of a method, or every use
  of a global across the Lua chunks of the document. `includeDeclaration` decides whether the
  local's declaration, or the assignments to the global, are included.
- Rename (`textDocument/prepareRename`, `textDocument/rename`) within the document, for locals
  and for globals the document assigns. Refused, with a reason localized in VS Code: anything
  that is not a variable, the implicit `self`, globals the document never assigns (defined in
  another file, the game or EEex), code with syntax errors where the variable can occur, new names
  that are not Lua names or are reserved words, and any rename that would change what a name
  refers to (checked by re-analyzing the renamed text). Edits are versioned when the client
  supports `documentChanges`.
- Error-tolerant Lua 5.2 parser and scope analysis (`src/server/syntax/`), checked against the
  official compiler by a differential test; it publishes no diagnostics of its own.
- Localization of the manifest and UI strings into all 14 VS Code display languages
  (machine-produced; review welcome).
- Setup guides for Sublime Text, Neovim, Emacs, JetBrains IDEs, Helix, Zed, Kate, Notepad++ and Geany.
- EEex documentation index (`data/eeex/`): names and deep links only, synced from the published
  Read the Docs build.
- Repository tooling: CI, CodeQL, commit linting, Dependabot with auto-merge, release automation,
  EEex docs sync, issue and pull request templates.

### Changed

- Minimum VS Code version is 1.91.0 (required by `vscode-languageclient` 10 and later).
- Versioning starts at 1.0.0: when no release exists yet, the Release workflow ships the
  committed `VERSION` as the first stable release (a pre-release before it would be 1.1.0).
- The Release workflow publishes only for merged `chore(release): …` pull requests, not for any
  other push that changes `VERSION`.
- The Release workflow records the installed size of each release for the README's install-size
  badge (`.github/badges/install-size.json`, a shields.io endpoint): the size VS Code shows in the
  extension's details, computed from the VSIX exactly as VS Code installs it
  (`scripts/release/vsix.mts`). CI checks it on release branches and the publish job against the
  VSIX it publishes; the exact byte count goes in the release notes.
- GitHub releases have the VSIX as their only asset; its SHA-256 moved from a separate
  `.vsix.sha256` file into the release notes, so the download count covers VSIX downloads only.
- CI integration jobs build the tests before running them, and a test run that finds no tests now
  fails. Until now the CI integration jobs ran 0 tests and passed.
