# What's New in IE Lua Language Server

All notable changes for users of the extension. The format is based on
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).

Versions with an **odd** middle number (for example 0.**1**.0) are pre-releases;
versions with an **even** middle number (for example 0.**2**.0) are stable releases.

## [Unreleased]

### Added

- **Syntax errors as you work.** Lua files and the Lua inside `.menu` files are checked
  with the official Lua 5.2 compiler, and errors appear in the Problems panel.
- **`.menu` files are recognized**, including upper-case names such as `UI.MENU`, with
  Lua highlighting inside them.
- **Choose when files are checked** with the *IE Lua › Validate: Mode* setting: on save
  (the default), while typing, both, or only on request.
- **Check a file on request** with the **IE Lua: Validate Current File** command.
- **Available in 14 languages**, following your VS Code display language.
- **Works in other editors too**: setup guides for Sublime Text, Neovim, Emacs, JetBrains
  IDEs, Helix, Zed, Kate, Notepad++ and Geany are on the project page.
