# Contributing

Thanks for helping! This document covers the development setup, the checks every change must pass,
and how releases work. By contributing you agree to the terms in [LICENSE.md](LICENSE.md) §5.

## Setup

Requirements: **Node.js 24** (see `.nvmrc`), npm, git, and VS Code 1.91 or later.

```sh
git clone https://github.com/4Luke4/IE-Lua-Language-Server.git
cd IE-Lua-Language-Server
npm ci
git config commit.template .gitmessage
```

npm may report that `esbuild` and `@vscode/vsce-sign` have install scripts that were not run. Neither
is needed: esbuild works from its platform package, and vsce-sign is only used for Marketplace
signing, which this project never does. Leave them unapproved.

Press <kbd>F5</kbd> in VS Code (**Run Extension**) to start an Extension Development Host with
`test/fixtures/workspace` open. **Extension + Language Server** also attaches the debugger to the
server (port 6009).

## Layout

| Path | Contents |
| --- | --- |
| `src/client/` | VS Code extension host code: activation, command, settings, language client |
| `src/server/` | Language server (separate Node process; no `vscode` import) |
| `src/server/validation/` | Pure validation logic, unit-tested without LSP or VS Code |
| `src/server/syntax/` | Error-tolerant Lua 5.2 parser, scope analysis, document symbols and folding (pure; checked against the official compiler by `test/unit/server/syntax/differential.test.ts`) |
| `src/shared/` | Types and constants used by both sides |
| `third_party/lua52/` | Reproducible build of the official Lua 5.2.4 compiler to WebAssembly |
| `data/eeex/` | Generated EEex documentation index (names and links) |
| `scripts/` | Repository tooling (TypeScript run directly by Node.js) |
| `test/unit/`, `test/integration/` | Mocha unit tests; VS Code integration tests |
| `docs/editors/` | Setup guides for other editors |

See [`CLAUDE.md`](CLAUDE.md) for the architecture rules.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run compile` / `npm run watch` | Development build of both bundles |
| `npm run check-types` | TypeScript type-check (esbuild does **not** type-check) |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm run test:unit` | Unit tests (plain Node.js) |
| `npm test` | Integration tests in VS Code 1.91.0 and current stable (on Linux without a display: `xvfb-run -a npm test`) |
| `npm run check-l10n` | Localization consistency check |
| `npm run package` | Production bundle |
| `npm run notices` | Regenerate `THIRD_PARTY_NOTICES.md` (after `npm run package`) |
| `npm run build:wasm` | Rebuild the Lua 5.2 WebAssembly module (needs Emscripten, see below) |

**Definition of done:** `check-types`, `lint` and `test:unit` pass. Run `npm test` too when you
touch activation, commands, settings or the language client/server wiring.

## Commit messages

Commits and pull request titles follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
(template: [`.gitmessage`](.gitmessage); rules: [`commitlint.config.mjs`](commitlint.config.mjs)).
CI rejects anything else, except Dependabot pull requests. Pull requests are squash-merged, so the
**title** becomes the commit on `main`, and its type decides the next version:

| Type | Version bump |
| --- | --- |
| `feat` | minor |
| `fix`, `perf`, `revert` | patch |
| `!` after the type, or a `BREAKING CHANGE:` footer | major (minor while the major is 0) |
| `docs`, `style`, `refactor`, `test`, `build`, `ci`, `chore` | none on their own |

## Changelogs

Add user-visible changes under `## [Unreleased]` in **both** files, following
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/):

- [`CHANGELOG.md`](CHANGELOG.md): detailed, for developers (shown on GitHub).
- [`docs/CHANGELOG.vsix.md`](docs/CHANGELOG.vsix.md): short and plain-language, shipped inside the
  VSIX and shown on the extension's *Changelog* tab in VS Code.

The VSIX changelog is English only: VS Code shows a single changelog file per extension and has no
mechanism for localized changelogs.

## Localization

The extension is translated into the 14 display languages VS Code offers
([list](https://code.visualstudio.com/docs/configure/locales#_available-locales)).

- Manifest strings: `package.nls.json` (English) and `package.nls.<locale>.json`.
- Runtime strings: `vscode.l10n.t('…')` in `src/client/`. After adding or changing one, run
  `npx @vscode/l10n-dev export --outDir l10n src/client` and update every `l10n/bundle.l10n.<locale>.json`.
- Keep code spans, setting links (`` `#ieLua.validate.mode#` ``) and `{0}` placeholders unchanged, and
  refer to commands by the locale's translated title. `npm run check-l10n` enforces all of this.

The current translations were machine-produced; corrections from native speakers are very welcome.

## The Lua 5.2 WebAssembly module

`third_party/lua52/dist/` is generated and committed, so normal development does not need
Emscripten. To rebuild it:

```sh
git clone --depth 1 --branch 6.0.13 https://github.com/emscripten-core/emsdk.git .cache/emsdk
.cache/emsdk/emsdk install 6.0.13 && .cache/emsdk/emsdk activate 6.0.13
source .cache/emsdk/emsdk_env.sh
npm run build:wasm            # rebuild
npm run build:wasm -- --check # verify the committed files are reproducible
```

The Emscripten version is pinned in `third_party/lua52/build.mts` (`EMSCRIPTEN_VERSION`); CI reads
it from there. The Lua tarball is verified against the SHA-256 published on <https://www.lua.org/ftp/>.

## Releases

Releases are private: VSIX files are attached to [GitHub Releases](https://github.com/4Luke4/IE-Lua-Language-Server/releases).
Nothing is ever published to a marketplace (`"private": true`; `vsce publish` is not used).

1. Make sure both changelogs describe the changes under `## [Unreleased]`.
2. Run the **Release** workflow (*Actions › Release › Run workflow*) and choose **pre-release** or
   **stable**. It computes the next version (odd minor for pre-releases, even minor for stable,
   always higher than every earlier release; the very first stable release is the committed
   `VERSION`, 1.0.0, and a pre-release before it would be 1.1.0), updates `VERSION`, `package.json`, `package-lock.json`
   and both changelogs, and opens a `chore(release): vX.Y.Z` pull request.
3. Review and merge that pull request. The workflow then verifies the version, runs the checks,
   packages the VSIX and creates the tag and the GitHub release (environment `release`). The VSIX
   is the release's only asset; its SHA-256 is at the end of the release notes.

## Repository settings (maintainers)

These settings live on GitHub, not in the repository. Create them once:

```sh
# Environment used by the publish job of release.yml.
gh api --method PUT repos/4Luke4/IE-Lua-Language-Server/environments/release

# Ruleset for main: pull requests only, required checks, no force pushes or deletion.
gh api --method POST repos/4Luke4/IE-Lua-Language-Server/rulesets --input - <<'JSON'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["squash"] } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "Detect changes" },
          { "context": "Type-check, lint, unit tests, package" },
          { "context": "Integration tests (VS Code minimum)" },
          { "context": "Integration tests (VS Code stable)" },
          { "context": "Conventional Commits" }
        ] } }
  ]
}
JSON
```
