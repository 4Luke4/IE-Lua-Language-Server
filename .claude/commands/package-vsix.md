---
description: Run all checks and build a private .vsix (never publishes)
argument-hint: [patch|minor|major]
---

Build a private VSIX release. Version bump (empty = no bump): $ARGUMENTS

1. Confirm `package.json` has `"private": true`. **Never run `vsce publish` or `ovsx publish`.**
2. Version bumps for released builds go through the Release workflow (CONTRIBUTING.md › Releases),
   which keeps `VERSION`, `package.json` and both changelogs in sync. For a local test build, do not bump.
3. Run, stopping at the first failure: `npm run check-types`, `npm run lint`, `npm run test:unit`, `npm test`.
4. Run `npm run package` (production esbuild bundle, minified, no source maps).
5. Run `npx @vscode/vsce ls --no-dependencies` and verify only the bundles, manifest, `package.nls*.json`, `l10n/`,
   grammar/language configuration, `images/icon.png`, `README.md`, `docs/CHANGELOG.vsix.md`, `LICENSE.md` and
   `THIRD_PARTY_NOTICES.md` are included (CI enforces the same list). Fix `.vscodeignore` if anything else appears.
6. Run `npx @vscode/vsce package --no-dependencies --changelog-path docs/CHANGELOG.vsix.md`.
7. Report the `.vsix` file name, its size, and the install command: `code --install-extension <file>.vsix`.
