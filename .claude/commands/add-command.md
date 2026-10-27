---
description: Scaffold a new VS Code command end-to-end (manifest, handler, registration, test)
argument-hint: <commandName> "<Title shown in Command Palette>"
---

Add a new command to this extension: $ARGUMENTS

Follow `CLAUDE.md` and `.claude/rules/extension-client.md`. Steps:

1. Read `package.json` and two existing files in `src/client/commands/` to match current patterns.
2. Add the command to `contributes.commands` with `command` (`<extension-name>.<commandName>`), `title` and `category`.
   Add a `commandPalette` `when` clause if it only makes sense in some contexts.
3. Create `src/client/commands/<commandName>.ts` exporting `register(context, deps)`. Keep the handler thin;
   put logic in a pure module with a unit test.
4. Register it in `src/client/extension.ts`, pushing the disposable to `context.subscriptions`.
5. Add an integration test in `test/integration/` that executes the command and asserts its effect.
6. Run `npm run check-types && npm run lint && npm run test:unit` and fix any failures.

Finish with a short summary of the files changed.
