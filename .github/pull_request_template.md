<!--
The title becomes the squash-merge commit message, so it must follow
Conventional Commits (https://www.conventionalcommits.org/en/v1.0.0/), e.g.
"feat(server): validate .menu expressions". See CONTRIBUTING.md.
-->

## What and why

<!-- What does this change, and why is it needed? Link issues with "Closes #123". -->

## How it was tested

<!-- Commands run, new tests, manual checks (editor + OS). -->

## Checklist

- [ ] `npm run check-types`, `npm run lint` and `npm run test:unit` pass
- [ ] `npm test` (integration) passes, if activation, commands, settings or the LSP wiring changed
- [ ] New logic has unit tests; new commands/settings have an integration test
- [ ] User-facing strings use `vscode.l10n.t()` / `package.nls.json`, and `npm run check-l10n` passes
- [ ] `CHANGELOG.md` and `docs/CHANGELOG.vsix.md` have entries under `[Unreleased]` (if users notice the change)
- [ ] No setting key or command ID was renamed (breaking change), or it is called out above
