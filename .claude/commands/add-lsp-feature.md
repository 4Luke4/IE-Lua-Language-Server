---
description: Implement a new language server feature (e.g. hover, completion, definition, code action)
argument-hint: <feature> [notes]
---

Implement the LSP feature: $ARGUMENTS

Follow `.claude/rules/language-server.md`. Steps:

1. **Plan first.** State which LSP request(s) are involved, the capability to advertise, and the files you will touch. Wait for confirmation if more than three files change.
2. Put the analysis logic in a pure module (no LSP or `vscode` imports) and unit-test it.
3. Create `src/server/features/<feature>.ts` exporting `register(connection, documents, deps)`; honor the `CancellationToken`.
4. Register it in `src/server/server.ts` and advertise the capability in `onInitialize` — only once the handler exists.
5. Add an integration test that opens a fixture and calls the matching `vscode.execute*Provider` command
   (e.g. `vscode.executeHoverProvider`) to assert the result.
6. Run `npm run check-types && npm run lint && npm run test:unit`, then `npm test`.
