---
description: Review the current changes against this project's VS Code extension standards
---

Review the uncommitted changes (`git diff` and `git diff --staged`) against `CLAUDE.md` and `.claude/rules/`.

Check specifically:
- Any `vscode` import under `src/server/` or `src/shared/`.
- Disposables not added to `context.subscriptions`; missing `client.stop()` in `deactivate`.
- Commands or settings present in code but missing from `package.json` (or the reverse).
- Settings read outside `src/client/config.ts`; manifest defaults that differ from code defaults.
- LSP capabilities advertised without a handler; handlers that ignore `CancellationToken` or can throw.
- Blocking or synchronous work in `activate` or on the server's event loop.
- New logic without tests; new dependencies without justification.
- Renamed command IDs or setting keys (breaking changes).

Report findings grouped as **Must fix**, **Should fix**, **Nit**, each with file:line and a concrete fix.
Do not edit files during the review.
