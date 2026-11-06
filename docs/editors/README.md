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
  { "ieLua": { "validate": { "mode": "saveAndType", "debounce": 300 }, "runtime": { "lua": "lua52" } } }
  ```

  | `validate.mode` | Diagnostics are updated |
  | --- | --- |
  | `manual` | never automatically |
  | `save` (default) | when a file is saved |
  | `type` | while typing, `debounce` milliseconds after the last change (also when a file is opened) |
  | `saveAndType` | both |

  Outside VS Code there is no "Validate Current File" command, so prefer `type` or `saveAndType`.

  | `runtime.lua` | Hover, completion and semantic tokens describe |
  | --- | --- |
  | `lua52` (default) | the libraries of the game's own Lua 5.2 |
  | `luajit` | the libraries of the LuaJIT that EEex's experimental *Use LuaJIT* component installs: everything but `bit32`, plus `bit`, `jit`, and `ffi`, `string.buffer`, `table.new` and `table.clear` through `require` |

  Syntax errors always come from the Lua 5.2 compiler. When the editor reports a settings change
  (`workspace/didChangeConfiguration`), the next request uses the new value, and an editor that
  supports `workspace/semanticTokens/refresh` is asked to re-color the open files.

## 4. What you get

| Feature | LSP request | Notes |
| --- | --- | --- |
| Syntax errors | `textDocument/publishDiagnostics` | When `validate.mode` says so (see above). In `.menu` files, also warnings for text the game misreads. Warnings for doc comments (see below). |
| Document symbols (outline) | `textDocument/documentSymbol` | Nested when the editor supports it, otherwise a flat list with container names. |
| Folding | `textDocument/foldingRange` | Whole lines; the closing line of each construct stays visible. |
| Go to definition | `textDocument/definition` | The declaration of a local, or every assignment to a global in the same file and in the other files of the workspace (as for workspace symbols, below). |
| Find references | `textDocument/references` | Every use of a local in its file, or of a global in the same file and in the other files of the workspace (as for workspace symbols, below). |
| Rename | `textDocument/prepareRename`, `textDocument/rename` | Same file only; refused, with the reason as the error message, when the rename could change what the code does. |
| Hover | `textDocument/hover` | Markdown or plain text, whichever the editor prefers (`hover.contentFormat`); the server's own words follow the editor's `locale`. See below. |
| Completion | `textDocument/completion`, `completionItem/resolve` | Triggered by `.` and `:`. Documentation is sent on resolve (with the item, for names with a doc comment), in the editor's preferred `completionItem.documentationFormat`. See below. |
| Semantic tokens | `textDocument/semanticTokens/full`, `/full/delta`, `/range` | Names only (keywords, strings and comments are left to the editor's highlighting). See below. |
| Formatting | `textDocument/formatting`, `/rangeFormatting`, `/onTypeFormatting` | `.lua` files only. Keeps your line breaks; uses the editor's tab size and spaces/tabs option. See below. |
| Quick fixes | `textDocument/codeAction` | `.menu` files only: kinds `quickfix` and `source.fixAll.ieLua`. Needs `codeActionLiteralSupport`. See below. |
| Workspace symbols | `workspace/symbol` | Every `*.lua` and `*.menu` file under the workspace folders, plus open files. See below. |

Workspace symbols, and go to definition and find references across files, need an editor that
sends **workspace folders** when it starts the server; otherwise only open files are searched.
Files changed outside the editor are picked up when the editor supports **dynamic registration
of watched files** (`workspace/didChangeWatchedFiles`);
otherwise they are picked up when the server restarts or the file is opened and closed. Files are
skipped as VS Code's `files.exclude` setting says, which the server reads with
`workspace/configuration` (section `files.exclude`). If your editor passes server *settings*
through `workspace/configuration` (your guide says whether it does), you can add one next to
`ieLua`, for example `{ "files": { "exclude": { "**/backup": true } } }`.
Only folders on the local disk are scanned.

Hover shows the [Lua 5.2 manual](https://www.lua.org/manual/5.2/manual.html) text for the
libraries the game provides (with `runtime.lua` set to `luajit`, also the
[LuaJIT](https://luajit.org/) documentation), a link to the EEex documentation for EEex and game
functions, and how your own variables and functions are declared. Method calls are described by
what their receiver provably is: `s:upper()` like `string.upper` when `s` is a string literal, a
local never reassigned that holds one, or a value annotated `---@type string`; `obj:m()` by the
`function Obj:m()` it calls (also `self:m()` inside a method, and values annotated with a
`---@class`); `w:CheckIfPaused()` through `local w = worldScreen`; and with LuaJIT, `buf:put()` and
`ffi.new()` through `require`. A receiver of unknown type gets no hover rather than a guess. Editors that render Markdown get code blocks and links;
others get plain text with the links written out. The few words of the server's own (such as
`parameter`) are translated when the editor sends a `locale` the extension supports (one of the
14 VS Code display languages, or its language alone: `de-AT` uses German); otherwise English.

Completion offers the variables in scope, the globals the file assigns, the Lua 5.2 libraries the
game provides and the EEex and game functions, with the hover's declaration line as the item's
detail and its documentation on resolve. Members are offered after `.` and `:` on globals
(`string.`, `C:`) and after `("…"):`; there is no type inference, so fields of locals are not.
Each item replaces the name around the cursor (`insertReplaceSupport` and
`completionList.itemDefaults` are used when the editor has them).

Semantic tokens classify every name in the Lua with standard token types (`namespace`,
`function`, `method`, `variable`, `parameter`, `property`, `label`) and modifiers
(`declaration`, `modification`, `defaultLibrary`), plus a `global` modifier for global variables.
`defaultLibrary` marks the Lua 5.2 library and the game's own functions (`Infinity_…`), not EEex
functions. How the names are colored depends on the editor and its color scheme; an editor that
ignores the `global` modifier still gets the token type.

Formatting changes only the white space between tokens and comments: indentation, spacing
within a line and trailing white space. Line breaks stay where you put them, and strings and
comments are never changed, apart from trailing white space after a `--` comment. It follows the
`tabSize` and `insertSpaces` the editor sends, and `insertFinalNewline` / `trimFinalNewlines`
when the editor sends them. A file with a syntax error is not formatted (the reason goes to the
server log). On-type formatting re-indents a line when you type the last character of `end`,
`else`, `elseif`, `until`, `)`, `]` or `}` at its start, and formats the line you leave with
Enter, if your editor sends on-type formatting requests (some send them only when an option is
turned on; see its documentation). Formatting is offered for Lua documents (language `lua`, or
`*.lua` in any letter case) and `.menu` documents (language `ie-menu`, or `*.menu` in any letter
case). In a `.menu` file, each line is indented by the `{ … }` blocks open at its start and the
embedded Lua is formatted one level deeper than the line it starts on (`` ` `` blocks outside any
block stay at level 0); strings that are not Lua, the spacing between `.menu` words and every
line break are kept. A Lua script with a syntax error is left as written while the rest of the
file is formatted; a file with an unterminated string or `` ` `` block is not formatted.

Quick fixes cover three `.menu` diagnostics, with the remedy IESDP gives:
`menu-unquoted-underscore` and `menu-word-too-long` put the text in `"…"`, and
`menu-inline-lua-last-character` inserts a space before the closing backtick. The action is
offered for a diagnostic only while its problem is still at the same place in the current text.
A fix changes the Lua the game compiles, as intended: the character it dropped before the
backtick now runs, and a quoted Lua property value is compiled whole, so validation may then
report an error the misread text hid.
The `source.fixAll.ieLua` action applies every fix of the file, whether or not diagnostics were
published; ask for that kind (or `source.fixAll`) to run it on save, if your editor can request
code actions on save. Action titles follow the editor's `locale`, like hover.

Hover and completion also show [LuaCATS](https://luals.github.io/wiki/annotations/) doc comments:
a run of `---` lines, each alone on its line, directly above a `local function`, a `local` with
one name, a `function` with one name or an assignment to one global (a global uses the comment
above its first assignment). The description and the `---@param`, `---@return`, `---@type`,
`---@deprecated` and `---@see` tags are shown in the order written, as VS Code shows JSDoc tags;
a parameter shows its own `---@param` line. Types are shown as written and never checked. With
the other diagnostics, the server publishes three warnings for doc comments:
`doc-tag-malformed` (a `---@param` without a name or type, a `---@return` or `---@type` without a
type), `doc-param-unknown` (a `---@param` the function written below does not have) and
`doc-param-duplicate` (a parameter documented twice). Their messages follow the editor's
`locale`, like hover.

Symbols, folding, hover, completion, semantic tokens, formatting, quick fixes and navigation always reflect the current text, whatever `validate.mode` is.
Navigation works on variables: table fields (`t.x`) and `goto` labels are not followed, and in a
`.menu` file globals are shared by all its Lua, while locals stay in their own block or script.
