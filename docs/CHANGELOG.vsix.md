# What's New in IE Lua Language Server

All notable changes for users of the extension. The format is based on
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).

Versions with an **odd** middle number (for example 1.**1**.0) are pre-releases;
versions with an **even** middle number (for example 1.**2**.0) are stable releases.

## [Unreleased]

### Added

- **Format Document and Format Selection for `.menu` files.** Each line is indented by the
  `{ … }` blocks around it, and the Lua inside is formatted like a Lua file, one level deeper
  than the line it starts on. Line breaks, the spacing between `.menu` words and text the game
  reads as a string stay exactly as written. A Lua script with a syntax error is left as it is,
  and the rest of the file is still formatted. *Editor: Format On Type* works here too.
- **LuaJIT support for EEex's *Use LuaJIT* component.** Set *IE Lua › Runtime: Lua* to `luajit`
  and hover and completion describe LuaJIT's libraries, quoted from the LuaJIT documentation:
  `bit`, `jit`, `ffi`, `string.buffer`, `table.new` and `table.clear`. `bit32`, which LuaJIT does
  not have, is then no longer offered. Syntax is still checked by the Lua 5.2 compiler.
- **Documentation for method calls.** `name:upper()` now shows the description of `string.upper`
  when `name` is surely a string: a string literal, a local that keeps one, or a value annotated
  `---@type string`. Your own methods, called as `obj:greet()` or `self:greet()`, show how you
  defined them and their doc comment, and so does hovering their name where you define them.
  EEex and game objects work through local names (`local w = worldScreen` then
  `w:CheckIfPaused()`), and with LuaJIT so do `buf:put()` and `ffi.new()`. Completion after `:`
  and `.` offers the same names. When the type of a value is not certain, nothing is shown rather
  than a guess.

## [1.0.0] - 2026-11-05

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
  gets its value: in the same file, including across the Lua of a `.menu` file, and in every
  other Lua and `.menu` file of your workspace, even files you haven't opened.
- **Find All References** lists every use of a variable: of a local in its file, of a global in
  every Lua and `.menu` file of your workspace.
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
- **Format Document and Format Selection** for Lua files. Fixes indentation and spacing without
  moving your line breaks, and never changes strings or the text of comments. It uses your
  editor's tab and indentation settings, and with *Editor: Format On Type* it re-indents `end`,
  `else` and closing brackets as you type them. Files with syntax errors are left as they are;
  `.menu` files are not formatted yet.
- **Quick fixes for `.menu` text the game misreads.** Click the light bulb (or press Ctrl+.)
  on a warning to put an unquoted name such as `My_Menu` or a too-long word in quotes, or to add
  the space the game needs before the closing backtick of a Lua block. Fix them all at once with
  *Fix all IE Lua auto-fixable problems*, or on every save with
  `"editor.codeActionsOnSave": { "source.fixAll.ieLua": "explicit" }`.
- **Your own documentation on hover.** Write doc comments in the LuaCATS style used by other Lua
  tools, `---` lines with `---@param`, `---@return`, `---@type`, `---@deprecated` and `---@see`,
  right above a function or variable, and hovering it shows the description and tags, as does
  its code completion suggestion. Hovering a parameter shows its `---@param` line. A warning
  tells you when a `---@param` names a parameter the function doesn't have, documents one twice,
  or misses its name or type.
- **Available in 14 languages**, following your VS Code display language.
- **Works in other editors too**: setup guides for Sublime Text, Neovim, Emacs, JetBrains
  IDEs, Helix, Zed, Kate, Notepad++ and Geany are on the project page.

[Unreleased]: https://github.com/4Luke4/IE-Lua-Language-Server/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/4Luke4/IE-Lua-Language-Server/releases/tag/v1.0.0
