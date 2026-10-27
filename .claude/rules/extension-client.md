---
paths:
  - "src/client/**/*.ts"
---

# Extension Client Rules

Applies to code running in the VS Code extension host.

## Activation
- `activate(context)` must be fast: register commands and start the language client; defer everything else.
- No synchronous file I/O and no network calls in `activate`.
- `deactivate()` returns `client?.stop()` so the server shuts down cleanly.

## Commands
- One command per file in `src/client/commands/`, exporting a `register(context, deps)` function.
- Handler shape: validate arguments → call pure logic → report result. Wrap in try/catch and log to the output channel.
- Long operations use `window.withProgress` and pass the `CancellationToken` through.
- Register in `extension.ts` **and** declare in `package.json` `contributes.commands` — both, always.

## Configuration
- All reads go through `src/client/config.ts`, which exposes typed getters whose defaults mirror `package.json`.
- React to changes with `workspace.onDidChangeConfiguration` and `e.affectsConfiguration('<extension-name>.<key>')`.
- Settings the server needs are forwarded via `synchronize.configurationSection` or answered through
  `workspace/configuration` requests — never re-read ad hoc.

## Logging
- One `window.createOutputChannel('<Extension Name>', { log: true })` shared across the client.
- Never `console.log` in shipped code.

## Don'ts
- Don't import from `src/server/`. Share types through `src/shared/` only.
- Don't keep global mutable state outside the activation scope.
- Don't use deprecated APIs; check the `@deprecated` tag in `@types/vscode`.
