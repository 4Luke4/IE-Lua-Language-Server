# What's New in IE Lua Language Server

All notable changes for users of the extension. The format is based on
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).

Versions with an **odd** middle number (for example 1.**1**.0) are pre-releases;
versions with an **even** middle number (for example 1.**2**.0) are stable releases.

## [Unreleased]

### Added

- **Syntax errors as you work.** Lua files and the Lua inside `.menu` files are checked
  with the official Lua 5.2 compiler, and errors appear in the Problems panel.
- **`.menu` files are recognized**, including upper-case names such as `UI.MENU`, with
  Lua highlighting inside them.
- **Warnings for `.menu` text the game reads differently than it looks**: an underscore in
  unquoted text (`My_Menu` is read as two words), a Lua block whose last character the game
  drops, and unquoted words long enough to make the game abort.
- **Choose when files are checked** with the *IE Lua › Validate: Mode* setting: on save
  (the default), while typing, both, or only on request.
- **Check a file on request** with the **IE Lua: Validate Current File** command.
- **Outline and breadcrumbs.** Functions, variables and table fields of Lua files, and each menu
  of a `.menu` file by name, appear in the Outline view, the breadcrumbs and
  **Go to Symbol in Editor**.
- **Code folding that follows the code.** Fold functions, loops, each branch of an `if`, tables,
  comments, and every block and script of a `.menu` file.
- **Go to Definition** jumps from a variable to where it is declared, or to where a global
  gets its value in the same file, including across the Lua of a `.menu` file.
- **Find All References** lists every use of a variable in the same file.
- **Rename Symbol** renames a variable everywhere in the file. It refuses, and tells you why,
  when the rename could break your code — for example when the new name is already used nearby.
- **Go to Symbol in Workspace** (Ctrl+T) finds functions, variables and menus in every Lua and
  `.menu` file of your workspace, even files you haven't opened. Files hidden with
  *Files: Exclude* are left out.
- **Documentation on hover.** Hover over a Lua function such as `string.format` to read its
  description from the Lua 5.2 manual, over an EEex or game function such as
  `Infinity_DisplayString` for a link to its EEex documentation, or over your own variables to
  see how they are declared. Only the libraries the game provides are documented, and `print`
  tells you that the game replaces it.
- **Code completion.** Suggestions for the variables in scope, the globals your file defines,
  the Lua functions the game provides (type `string.` for the string library), and EEex and
  game functions such as `Infinity_DisplayString`, or methods after `C:`. Lua functions show
  their description from the Lua 5.2 manual, EEex and game functions a link to their
  documentation. In `.menu` files, completion works inside the Lua.
- **Colors that show what each name is.** With a theme that uses semantic highlighting, such as
  VS Code's default theme, parameters, local and global variables, functions, table fields and
  the functions the game provides can be colored differently, in Lua files and the Lua of `.menu`
  files. Themes can style globals with the `global` modifier.
- **Available in 14 languages**, following your VS Code display language.
- **Works in other editors too**: setup guides for Sublime Text, Neovim, Emacs, JetBrains
  IDEs, Helix, Zed, Kate, Notepad++ and Geany are on the project page.
