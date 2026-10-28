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
| Syntax errors | `textDocument/publishDiagnostics` | When `validate.mode` says so (see above). |
| Document symbols (outline) | `textDocument/documentSymbol` | Nested when the editor supports it, otherwise a flat list with container names. |
| Folding | `textDocument/foldingRange` | Whole lines; the closing line of each construct stays visible. |

Symbols and folding always reflect the current text, whatever `validate.mode` is.
