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
> This is an early version. It currently provides **syntax diagnostics**, **document symbols**,
> **folding**, **go to definition**, **find references** and **rename** within a file; completion,
> hover, workspace-wide navigation, formatting and more are planned.

## Features

- **Syntax errors from the official Lua 5.2 compiler.** The real Lua 5.2.4 front end, built to
  WebAssembly, checks your code — nothing to install, and no code is ever run.
- **`.menu` files understood.** Lua inside `` `…` `` blocks, `action`/`onOpen`/`onClose` scripts,
  `enabled "…"` and `<property> lua "…"` expressions is checked, and errors point to the right line
  of the `.menu` file. Upper-case names like `UI.MENU` are recognized, with Lua highlighting.
- **You decide when files are checked:** on save (default), while typing, both, or only on request.
- **Outline and breadcrumbs.** Functions, methods, top-level variables and table fields of Lua files,
  and each menu of a `.menu` file by its `name`, in the Outline view, the breadcrumbs and
  **Go to Symbol in Editor**. Works while the file still has syntax errors.
- **Folding that follows the code:** functions, loops, each `if`/`elseif`/`else` branch, tables,
  comments, and every `{ … }` block and Lua script of a `.menu` file.
- **Go to Definition, Find All References and Rename Symbol** for variables within a file. Locals
  follow Lua's scoping rules; globals are followed across all the Lua of a `.menu` file. Rename
  refuses, and says why, when it could change what the code does: a name already in use nearby,
  a reserved word, or a global that is defined outside the file.
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

Both settings can be set per workspace folder.

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
