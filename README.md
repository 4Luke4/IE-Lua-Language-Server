# IE Lua Language Server

[![CI](https://img.shields.io/github/actions/workflow/status/4Luke4/IE-Lua-Language-Server/ci.yml?branch=main&label=CI&logo=github)](https://github.com/4Luke4/IE-Lua-Language-Server/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/4Luke4/IE-Lua-Language-Server/codeql.yml?branch=main&label=CodeQL&logo=github)](https://github.com/4Luke4/IE-Lua-Language-Server/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/4Luke4/IE-Lua-Language-Server?include_prereleases&sort=semver&label=release)](https://github.com/4Luke4/IE-Lua-Language-Server/releases)
[![Downloads](https://img.shields.io/github/downloads/4Luke4/IE-Lua-Language-Server/total?label=downloads&logo=github)](https://github.com/4Luke4/IE-Lua-Language-Server/releases)
[![Install size](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2F4Luke4%2FIE-Lua-Language-Server%2Fmain%2F.github%2Fbadges%2Finstall-size.json)](#installation)
[![License: proprietary](https://img.shields.io/badge/license-proprietary-informational)](LICENSE.md)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-fe5196?logo=conventionalcommits&logoColor=white)](https://www.conventionalcommits.org/en/v1.0.0/)

Lua language support for the **Infinity Engine Enhanced Edition** games and the
[EEex](https://github.com/Bubb13/EEex) ecosystem: for `.lua` files and for the Lua embedded in
`.menu` files such as `UI.MENU`.

> [!NOTE]
> This is an early version. It currently provides **syntax diagnostics**, **hover**,
> **completion**, **semantic highlighting**, **formatting** (Lua and `.menu` files), **document symbols**,
> **workspace symbols**, **folding**, **quick fixes** (`.menu` files), **LuaCATS doc comments**
> in hover, completion and diagnostics, **go to definition** and **find references** across
> the files of your workspace, and **rename** within a file; more is planned.

## Features

- **Syntax errors from the official Lua 5.2 compiler.** The real Lua 5.2.4 front end, built to
  WebAssembly, checks your code — nothing to install, and no code is ever run.
- **`.menu` files understood as the game reads them.** All the Lua the game compiles is checked,
  in the exact form it compiles it: `` `…` `` blocks, `onOpen`/`onClose`/`action…` scripts, and
  `enabled`, `table`, `lua "…"` and other expressions, in `"…"` or `'…'`, plus the Lua the game
  generates from `slotinfo` and `spellInfo`. Errors point to the right line of the `.menu` file,
  and warnings flag text the game reads differently than it looks, such as `My_Menu` unquoted.
  Upper-case names like `UI.MENU` are recognized, with Lua highlighting. The rules come from the
  [IESDP description of the format](https://gibberlings3.github.io/iesdp/file_formats/ie_formats/menu_v1.htm).
- **You decide when files are checked:** on save (default), while typing, both, or only on request.
- **Outline and breadcrumbs.** Functions, methods, top-level variables and table fields of Lua files,
  and each menu of a `.menu` file by its `name`, in the Outline view, the breadcrumbs and
  **Go to Symbol in Editor**. Works while the file still has syntax errors.
- **Go to Symbol in Workspace** across every Lua and `.menu` file of your workspace, including files
  you haven't opened; files hidden with *Files: Exclude* are left out.
- **Folding that follows the code:** functions, loops, each `if`/`elseif`/`else` branch, tables,
  comments, and every `{ … }` block and Lua script of a `.menu` file.
- **Documentation on hover.** Lua functions such as `string.format` show their description from
  the [Lua 5.2 manual](https://www.lua.org/manual/5.2/manual.html), word for word, with a link to
  it, and so do method calls such as `name:upper()` when `name` is surely a string (a string
  literal, a local that keeps one, or a value annotated `---@type string`). Your own methods
  (`obj:greet()`, `self:greet()`) show how you defined them and their doc comment, and with the
  `luajit` runtime the [LuaJIT documentation](https://luajit.org/) covers `bit`, `jit`, `ffi` and
  string buffers (`buf:put()`). Where the type of a value is not certain, nothing is shown
  rather than a guess. Only the libraries the game provides are documented (`io`, `os`, `require` and coroutines
  are not), and `print` tells you that the game replaces it. EEex and game functions such as
  `Infinity_DisplayString` or `C:AddGold` link to the
  [EEex documentation](https://eeex-docs.readthedocs.io/en/latest/), and your own variables show
  how they are declared.
- **Code completion** for the variables in scope, the globals your file defines, the Lua functions
  the game provides (`string.` lists the string library), and EEex and game functions
  (`Infinity_…`, `EEex_…`, and methods after `C:`), with the same documentation as on hover.
  After `:` or `.` on a local, it offers what that value surely has: the string library after a
  string, your own methods after a table that defines them, LuaJIT's methods after a string
  buffer.
  Nothing the game lacks is suggested (`io`, `os`, `require`, coroutines). In `.menu` files,
  completion works inside the Lua only.
- **Colors that show what each name is.** Parameters, local and global variables, functions,
  table fields and the functions the game provides can each have their own color: the extension
  tells VS Code what every name in the Lua is, by the same rules as hover. This needs a theme
  that uses semantic highlighting, such as VS Code's default theme. Globals carry a `global`
  modifier that you can style yourself, for example in `settings.json`:

  ```json
  "editor.semanticTokenColorCustomizations": {
    "rules": { "*.global": { "bold": true } }
  }
  ```
- **Format Document and Format Selection** for Lua and `.menu` files: indentation, spacing within a line and
  trailing white space are fixed, while your line breaks stay where they are and strings and
  comments are never changed (apart from trailing white space after a `--` comment). Tabs or spaces follow your editor settings (*Editor: Tab Size*,
  *Editor: Insert Spaces*). Turn on *Editor: Format On Type* to have `end`, `else` and closing
  brackets re-indented as you type them, or *Editor: Format On Save*. Files with a syntax error
  are left unchanged. In `.menu` files, each line is indented by the `{ … }` blocks around it and
  the Lua inside is formatted one level deeper than the line it starts on (the Lua of a
  `` ` `` block outside any menu stays at the left margin, as in a Lua file); text the game reads
  as a string, the spacing between `.menu` words and every line break stay exactly as written.
  A Lua script with a syntax error is left as it is, and the rest of the file is still formatted.
- **Go to Definition and Find All References** for variables. Locals follow Lua's scoping rules.
  Globals are followed across every Lua and `.menu` file of your workspace, even files you
  haven't opened, because the game runs all of its Lua in
  [one shared global state](https://gibberlings3.github.io/iesdp/file_formats/ie_formats/lua_globals.htm).
  Files hidden with *Files: Exclude* are left out.
- **Rename Symbol** for variables within a file. Rename refuses, and says why, when it could
  change what the code does: a name already in use nearby, a reserved word, or a global that is
  defined outside the file.
- **Quick fixes for `.menu` text the game misreads.** Put an unquoted name such as `My_Menu`, or
  a word too long for the game, in quotes, or add the space the game needs before the closing
  backtick of a Lua block, from the light bulb (Ctrl+.). *Fix all IE Lua auto-fixable problems*
  fixes the whole file; to do it on every save, add
  `"editor.codeActionsOnSave": { "source.fixAll.ieLua": "explicit" }` to your settings.
- **Your own documentation from doc comments.** Write [LuaCATS](https://luals.github.io/wiki/annotations/)
  doc comments, the `---` style other Lua tools read, on the lines right above a function or
  variable:

  ```lua
  --- Builds a greeting.
  ---@param name string Who to greet.
  ---@return string greeting
  local function greet(name) return "Hello, " .. name end
  ```

  Hover and completion then show the description and the `@param`, `@return`, `@type`,
  `@deprecated` and `@see` tags, and hovering a parameter shows its `@param` line. Types are shown
  as you write them; they are not checked. A warning points out a `---@param` that names a
  parameter the function doesn't have, documents one twice, or misses its name or type.
- **Available in 14 languages**, following your VS Code display language.
- **Works in other editors** through the Language Server Protocol.

## Installation

This extension is distributed privately as a `.vsix` file.

1. Download `ie-lua-language-server-<version>.vsix` from
   [Releases](https://github.com/4Luke4/IE-Lua-Language-Server/releases).
2. In VS Code, run **Extensions: Install from VSIX…** from the Command Palette, or in a terminal:

   ```sh
   code --install-extension ie-lua-language-server-<version>.vsix
   ```

Requires VS Code **1.91** or later.

The *downloads* badge counts downloads of the `.vsix` files of all releases, as reported by
GitHub; GitHub does not say who downloads, so maintainers' own downloads are included. The
*install size* badge shows the size VS Code reports for the latest release once installed.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `ieLua.validate.mode` | `save` | When files are checked: `manual` (only with the command below), `save`, `type` (while typing), or `saveAndType`. |
| `ieLua.validate.debounce` | `300` | Milliseconds to wait after the last change before checking, in `type` and `saveAndType` modes. |
| `ieLua.runtime.lua` | `lua52` | The Lua the game runs: `lua52` (the game's own), or `luajit` if you installed EEex's experimental *Use LuaJIT* component. With `luajit`, hover and completion describe LuaJIT's libraries (`bit`, `jit`, `ffi`, `string.buffer`, `table.new`, `table.clear`) and no longer `bit32`, which LuaJIT does not have. Syntax is still checked by the Lua 5.2 compiler. |

All settings can be set per workspace folder.

## Commands

| Command | Description |
| --- | --- |
| **IE Lua: Validate Current File** | Checks the active `.lua` or `.menu` file now, whatever the mode. |

## Other editors

The language server runs on its own with Node.js. Setup guides:
[Sublime Text](docs/editors/sublime-text.md) ·
[Neovim](docs/editors/neovim.md) ·
[Emacs](docs/editors/emacs.md) ·
[JetBrains IDEs](docs/editors/jetbrains.md) ·
[Helix](docs/editors/helix.md) ·
[Zed](docs/editors/zed.md) ·
[Kate](docs/editors/kate.md) ·
[Notepad++](docs/editors/notepad-plus-plus.md) ·
[Geany](docs/editors/geany.md).
Start with the [common steps](docs/editors/README.md).

## Release channels

Versions follow VS Code's convention: an **even** middle number (1.**2**.0) is a stable release,
an **odd** one (1.**1**.0) is a pre-release. The first stable release is 1.0.0.
See [CHANGELOG.md](CHANGELOG.md).

## Contributing and support

- Bugs and ideas: [open an issue](https://github.com/4Luke4/IE-Lua-Language-Server/issues/new/choose).
- Security problems: see [SECURITY.md](SECURITY.md).
- Development setup: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Proprietary — see [LICENSE.md](LICENSE.md). Third-party components and their licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Infinity Engine, Baldur's Gate, Icewind Dale and Planescape: Torment are trademarks of their
respective owners. This project is not affiliated with or endorsed by them. Function names and links
to the [EEex documentation](https://eeex-docs.readthedocs.io/) are used with credit to its authors.
