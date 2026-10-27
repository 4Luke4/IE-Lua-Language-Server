---
description: Add a new typed configuration setting and wire it through client (and server, if needed)
argument-hint: <area.name> <type> <default> "<description>"
---

Add a new configuration setting: $ARGUMENTS

1. Add it under `contributes.configuration.properties` in `package.json` as `<extension-name>.<area.name>`,
   with `type`, `default`, `markdownDescription`, a sensible `scope`, and `enum` + `enumDescriptions` if applicable.
2. Add a typed getter to `src/client/config.ts` whose default matches the manifest exactly.
3. If the language server needs it, add it to the shared settings type in `src/shared/` and make sure the server
   reads it via `workspace/configuration` (or the synchronized section) and reacts to `onDidChangeConfiguration`.
4. Handle live changes: the feature must pick up the new value without a window reload.
5. Add a unit test for any normalization/validation logic.
6. Run `npm run check-types && npm run lint && npm run test:unit`.

Do **not** rename or remove existing settings — that is a breaking change; ask first.
