---
description: Run all checks and build a private .vsix (never publishes)
argument-hint: [patch|minor|major]
---

Build a private VSIX release. Version bump (empty = no bump): $ARGUMENTS

1. Confirm `package.json` has `"private": true`. **Never run `vsce publish` or `ovsx publish`.**
2. If a bump was requested, update `version` with `npm version <bump> --no-git-tag-version`
   and add a dated entry to `CHANGELOG.md` summarizing changes since the last version.
3. Run, stopping at the first failure: `npm run check-types`, `npm run lint`, `npm run test:unit`, `npm test`.
4. Run `npm run package` (production esbuild bundle, minified, no source maps).
5. Run `npx @vscode/vsce ls` and verify only `dist/`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`
   and declared assets are included. Fix `.vscodeignore` if anything else appears.
6. Run `npx @vscode/vsce package --no-dependencies`.
7. Report the `.vsix` file name, its size, and the install command: `code --install-extension <file>.vsix`.
