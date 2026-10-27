---
paths:
  - "test/**/*.ts"
---

# Testing Rules

## Unit Tests (`test/unit/`)
- Run in plain Node with Mocha — no VS Code instance. Must never import `vscode`.
- Target pure logic: parsers, analyzers, formatters, config normalization.
- Fast and deterministic: no network, no real timers (use fake timers), no reliance on test order.

## Integration Tests (`test/integration/`)
- Run inside VS Code through `@vscode/test-cli` + `@vscode/test-electron` (`npm test`).
- Open fixtures from `test/fixtures/` — never depend on the developer's own workspace or settings.
- Await activation explicitly: `await vscode.extensions.getExtension('<publisher>.<name>')!.activate()`.
- For LSP features, wait for a concrete signal (diagnostics changed, provider returned) instead of fixed `sleep`s.
- Clean up: close editors and restore any settings changed during the test.

## Conventions
- File naming: `<subject>.test.ts`, mirroring the `src/` path.
- One behavior per `it(...)`; the title states the expected behavior, not the implementation.
- A bug fix starts with a failing test that reproduces it.
