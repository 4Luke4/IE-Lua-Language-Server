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
  with embedded Lua highlighting, and validation of `` `…` `` blocks, `action*`/`onOpen`/`onClose`
  scripts, `enabled "…"` and `<property> lua "…"` expressions.
- Settings `ieLua.validate.mode` (`manual`, `save` (default), `type`, `saveAndType`) and
  `ieLua.validate.debounce` (default 300 ms).
- Command **IE Lua: Validate Current File** (`ieLua.validateDocument`).
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
