# Using IE Lua Language Server in other editors

The language server is a standalone Node.js program, so any editor with a
[Language Server Protocol](https://microsoft.github.io/language-server-protocol/) client can use it.

| Editor | LSP client | Guide |
| --- | --- | --- |
| Sublime Text | [LSP](https://github.com/sublimelsp/LSP) package | [sublime-text.md](sublime-text.md) |
| Neovim | built in (0.11 or later) | [neovim.md](neovim.md) |
| Emacs | Eglot, built in (29 or later) | [emacs.md](emacs.md) |
| JetBrains IDEs | [LSP4IJ](https://github.com/redhat-developer/lsp4ij) plugin | [jetbrains.md](jetbrains.md) |
| Helix | built in | [helix.md](helix.md) |
| Zed | extensions only | [zed.md](zed.md) |
| Kate | LSP Client plugin, bundled | [kate.md](kate.md) |
| Notepad++ | [NppLspClient](https://github.com/Ekopalypse/NppLspClient) plugin | [notepad-plus-plus.md](notepad-plus-plus.md) |
| Geany | LSP Client plugin from geany-plugins 2.1 or later | [geany.md](geany.md) |

## 1. Install Node.js

Install [Node.js](https://nodejs.org/) **20.9 or later** and make sure `node --version` works in a terminal.

## 2. Get the server

1. Download the `.vsix` file of the latest release from
   [GitHub Releases](https://github.com/4Luke4/IE-Lua-Language-Server/releases).
2. A `.vsix` file is a ZIP archive. Extract it (rename it to `.zip` first if your tool insists).
3. Copy `extension/dist/server/server.js` to a permanent folder, for example
   `~/.local/share/ie-lua-language-server/server.js` or
   `C:\Tools\ie-lua-language-server\server.js`.

`server.js` is self-contained: nothing else needs to be installed. In the guides,
**`/path/to/server.js`** stands for the full path you chose.

Check that it starts (it waits silently for an editor; stop it with <kbd>Ctrl</kbd>+<kbd>C</kbd>):

```sh
node /path/to/server.js --stdio
```

## 3. What the server needs from your editor

- **Start command:** `node /path/to/server.js --stdio`
- **Files:** `*.lua`, and `*.menu` in any letter case (`UI.MENU`). The server recognizes menu
  files by their extension, so any file type or language ID is fine for them.
- **Settings (optional):** an `ieLua` object. Editors pass it either as server *settings*
  (`workspace/configuration`) or as *initialization options*; each guide shows which.

  ```json
  { "ieLua": { "validate": { "mode": "saveAndType", "debounce": 300 } } }
  ```

  | `validate.mode` | Diagnostics are updated |
  | --- | --- |
  | `manual` | never automatically |
  | `save` (default) | when a file is saved |
  | `type` | while typing, `debounce` milliseconds after the last change (also when a file is opened) |
  | `saveAndType` | both |

  Outside VS Code there is no "Validate Current File" command, so prefer `type` or `saveAndType`.

## 4. What you get

| Feature | LSP request | Notes |
| --- | --- | --- |
| Syntax errors | `textDocument/publishDiagnostics` | When `validate.mode` says so (see above). In `.menu` files, also warnings for text the game misreads. |
| Document symbols (outline) | `textDocument/documentSymbol` | Nested when the editor supports it, otherwise a flat list with container names. |
| Folding | `textDocument/foldingRange` | Whole lines; the closing line of each construct stays visible. |
| Go to definition | `textDocument/definition` | The declaration of a local, or every assignment to a global, in the same file. |
| Find references | `textDocument/references` | Every use of a local or global in the same file. |
| Rename | `textDocument/prepareRename`, `textDocument/rename` | Same file only; refused, with the reason as the error message, when the rename could change what the code does. |
| Hover | `textDocument/hover` | Markdown or plain text, whichever the editor prefers (`hover.contentFormat`); the server's own words follow the editor's `locale`. See below. |
| Completion | `textDocument/completion`, `completionItem/resolve` | Triggered by `.` and `:`. Documentation is sent on resolve, in the editor's preferred `completionItem.documentationFormat`. See below. |
| Workspace symbols | `workspace/symbol` | Every `*.lua` and `*.menu` file under the workspace folders, plus open files. See below. |

Workspace symbols need an editor that sends **workspace folders** when it starts the server;
otherwise only open files are searched. Files changed outside the editor are picked up when the
editor supports **dynamic registration of watched files** (`workspace/didChangeWatchedFiles`);
otherwise they are picked up when the server restarts or the file is opened and closed. Files are
skipped as VS Code's `files.exclude` setting says, which the server reads with
`workspace/configuration` (section `files.exclude`). If your editor passes server *settings*
through `workspace/configuration` (your guide says whether it does), you can add one next to
`ieLua`, for example `{ "files": { "exclude": { "**/backup": true } } }`.
Only folders on the local disk are scanned.

Hover shows the [Lua 5.2 manual](https://www.lua.org/manual/5.2/manual.html) text for the
libraries the game provides, a link to the EEex documentation for EEex and game functions, and
how your own variables are declared. Editors that render Markdown get code blocks and links;
others get plain text with the links written out. The few words of the server's own (such as
`parameter`) are translated when the editor sends a `locale` the extension supports (one of the
14 VS Code display languages, or its language alone: `de-AT` uses German); otherwise English.

Completion offers the variables in scope, the globals the file assigns, the Lua 5.2 libraries the
game provides and the EEex and game functions, with the hover's declaration line as the item's
detail and its documentation on resolve. Members are offered after `.` and `:` on globals
(`string.`, `C:`) and after `("…"):`; there is no type inference, so fields of locals are not.
Each item replaces the name around the cursor (`insertReplaceSupport` and
`completionList.itemDefaults` are used when the editor has them).

Symbols, folding, hover, completion and navigation always reflect the current text, whatever `validate.mode` is.
Navigation works on variables: table fields (`t.x`) and `goto` labels are not followed, and in a
`.menu` file globals are shared by all its Lua, while locals stay in their own block or script.
