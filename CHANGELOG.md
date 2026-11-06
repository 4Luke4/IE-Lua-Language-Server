# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this
project uses [VS Code's extension versioning](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions):
plain `major.minor.patch`, with an **even minor for stable releases** and an **odd minor for
pre-releases**. Versions are computed by the release workflow from
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

This is the detailed, developer-facing changelog. The user-facing release notes shipped inside
the extension live in [`docs/CHANGELOG.vsix.md`](docs/CHANGELOG.vsix.md).

## [Unreleased]

## [1.2.0] - 2026-11-06

### Added

- Formatting of `.menu` files (`textDocument/formatting`, `/rangeFormatting` and
  `/onTypeFormatting`; `src/server/formatting/menuFormat.ts`), layout-preserving like Lua
  formatting. The formatting selector (`FORMAT_SELECTOR`, formerly `LUA_SELECTOR`) adds the
  `ie-menu` language and `**/*.[mM][eE][nN][uU]`.
  - Only white space the engine's lexer skips changes (IESDP, MENU file format, Lexical
    structure). Each line is indented by the `{ … }` blocks open at its start; a line that starts
    with `}` is indented like the line that opened the block. Trailing white space is removed and
    blank lines are emptied. The spacing within a line is kept, and the lines of a string that is
    not Lua (`text "…"`) are never touched.
  - Each Lua chunk is formatted by the Lua rules (`formatEmbedded`, new in
    `src/server/formatting/format.ts`), its lines one level deeper than the line where it starts
    (`action "`, or a `"` on its own line). `` ` `` blocks outside any `{ … }` block hold a file's
    top-level Lua and stay at level 0. A line that starts with the closing backtick or quote is
    indented like the line where the chunk starts. The white space before the first Lua item on
    the opening line, and after the last one on the closing line, is kept.
  - The character before a closing backtick, which the engine drops, stays white space or is
    not touched. A chunk with a Lua syntax error (including Lua the engine sees cut short by
    that dropped character) is left as written, the rest of the file is formatted, and the count
    is logged.
  - A file with an unterminated string or `` ` `` block is not formatted (logged). The result is
    lexed and extracted again and must give the same menu tokens, Lua chunks, Lua tokens and
    comments, problems and lines, or nothing is changed.
  - Range formatting keeps the edits of the touched lines. On-type formatting uses the Lua
    triggers: a line break formats the line it ended; the last character of a Lua closer, or a
    `}` of the menu, that starts its line re-indents that line. `insertFinalNewline` and
    `trimFinalNewlines` are honored for document formatting.
- `data/luajit/manual.json` and its generator `scripts/luajit-manual/` (`npm run luajit-manual`,
  `-- --check` in the new CI job `luajit`, run when the generator, the shared converter or either
  data file changes; pinned sources cached by key). The data describes the LuaJIT that EEex's
  "Use LuaJIT" component installs: `LuaJIT/VERSION.TXT` of Bubb13/InfinityLoader (pinned commit)
  names the LuaJIT commit, and the text comes from that commit's documentation (`extensions.html`,
  `ext_buffer.html`, `ext_jit.html`, `ext_ffi_api.html`) and from Lua BitOp 1.0.4 `doc/api.html`
  for `bit.*`, word for word. What exists comes from the build's own sources: `lib_init.c`
  (libraries opened as globals and preloaded for `require`) and the `lib_*.c` registrations,
  with the feature flags of `msvcbuild.bat` (`LUAJIT_ENABLE_LUA52COMPAT`) as `lj_arch.h` derives
  them. Every documented name must be registered, and every Lua 5.2 manual entry that the build
  lacks is listed (only `bit32` and its functions). Every file is verified by SHA-256; anything
  the generator does not model stops it with the file and line.
- Setting `ieLua.runtime.lua` (`lua52` (default) | `luajit`, `resource` scope, localized in every
  manifest locale), read per document through the server's one `SettingsStore`, now shared by
  diagnostics, hover, completion and semantic tokens. With `luajit`, the libraries described
  (`Library` in `src/server/hover/knowledge.ts`) are the Lua 5.2 manual's minus the entries
  `data/luajit/manual.json` lists as unavailable (`bit32`), plus the LuaJIT globals `bit` and `jit`;
  `ffi`, `string.buffer`, `table.new` and `table.clear` are known as `require` targets. Hover and
  completion handlers read the setting before answering (then re-check the document and the
  cancellation); completion items carry the runtime in `data`, so `completionItem/resolve` uses
  the same library (items without it resolve with Lua 5.2); semantic tokens are cached per
  document and runtime, and a settings change sends `workspace/semanticTokens/refresh` when the
  client supports it. Syntax validation follows the setting too (next entry). The LuaJIT and Lua
  BitOp licenses, recorded verbatim in the data, are added to `THIRD_PARTY_NOTICES.md`.
- Syntax diagnostics by LuaJIT's own lexer and parser when `ieLua.runtime.lua` is `luajit`
  (`src/server/validation/luajit.ts`), in `.lua` files and in every compiled form of `.menu`
  Lua, so `1LL`, `0x10ULL`, `3i`, `0b101` and `"\u{20AC}"` are no longer errors there. The
  checker is chosen per document; LuaJIT is loaded on first use. When the setting changes, open
  documents whose diagnostics came from the other compiler are checked again, in every validate
  mode. Messages are LuaJIT's own (`near '<eof>'` maps to the end of the chunk:
  `parseLuaError(raw, dialect)` in `luaError.ts`). Production `dist/server/server.js` grows from
  810,957 to 1,058,231 bytes.
  - `third_party/luajit/` (`npm run build:wasm:luajit`, `-- --check` in the new CI job
    `luajit-wasm`): the `LuaJIT/` directory of Bubb13/InfinityLoader at the commit the LuaJIT
    manual data uses, fetched with git and verified by its tree hash (`source.mts`), is built to
    WebAssembly following LuaJIT's `src/Makefile` and `msvcbuild.bat` (host tools compiled by
    emcc and run by Node). Every `lj_*.c` and `lib_*.c` is compiled unchanged, with
    `msvcbuild.bat`'s `LUAJIT_ENABLE_LUA52COMPAT` and the target options `LUAJIT_TARGET=x86`,
    `LUAJIT_DISABLE_JIT` and `LUAJIT_SECURITY_PRNG=0`; byte-for-byte reproducible.
  - `validate.c` replaces the interpreter that buildvm generates as machine code (no WebAssembly
    target): `lj_vm_cpcall` and `lj_vm_unwind_c` with `setjmp`/`longjmp`, through `lj_frame.h`'s
    `cframe_*` macros; `lj_vm_floor` with `floor()`; the entry points that would run Lua code or
    FFI calls stop the module with a message. It loads with mode `"tX"`, which lays out frames in
    two slots as EEex's x64 GC64 build does, and opens the FFI library once so that no finalizer
    ever needs the interpreter.
  - `third_party/luajit/differential.mts` (`npm run luajit-differential`, CI): builds a native
    x64 LuaJIT from the same tree and fails if any chunk of `test/fixtures/luajit-syntax/` or of
    the generated limit cases (call arguments, nesting, locals, upvalues) gets a different answer.
- LuaJIT's lexical extensions in the server's own lexer (`src/server/syntax/lexer.ts`) when
  `ieLua.runtime.lua` is `luajit`, so hover, completion, semantic tokens, folding, document and
  workspace symbols, definition, references, rename and formatting work on files that use them
  (formatting refused such files as having syntax errors). Ported from the pinned LuaJIT tree:
  numerals are read as `lj_lex.c` `lex_number` reads them and checked as `lj_strscan_scan` does
  with `STRSCAN_OPT_LL | STRSCAN_OPT_IMAG` (`isLuaJitNumber`: `LL`/`ULL`/`LLU` on integers that
  fit in 64 bits, `i` on any number, `0b` with at most 64 binary digits, exponent and fraction
  limits of 2^20); `\u{X…}` escapes follow `lex_string` (below U+110000, no surrogates). Lua 5.2
  lexing is unchanged. Names stay ASCII in both modes (LuaJIT also accepts bytes from 0x80 in
  names).
  - `lex(source, from, to, runtime)`, `ParseOptions.runtime`, `Chunk.runtime`,
    `ParsedDocument.runtime` and `parseDocument(text, kind, runtime)`; the formatter, rename and
    completion lex again with the tree's runtime.
  - `ParsedDocumentCache.get(document, runtime)` reuses a parse only for the same version and
    runtime; features read the runtime per document first (`src/server/features/openDocument.ts`).
    The workspace index parses files that are not open with their folder's runtime
    (`WorkspaceIndexDeps.analysisOptions`) and re-indexes when it changes.
  - `test/unit/server/syntax/luajitDifferential.test.ts` compares the parser with the LuaJIT
    WebAssembly module on `test/fixtures/luajit-syntax/` (except goto/label semantics), every
    numeral of up to four characters, 64-bit and exponent limits, `\u{…}` boundaries and token
    mutations of LuaJIT seeds. The mutation helper moved to `test/unit/server/syntax/mutations.ts`.
- Method syntax in hover, completion and semantic tokens (`src/server/hover/receiver.ts`, through
  `memberTarget` in `src/server/hover/resolve.ts`). A receiver is typed only when the code or a
  LuaCATS annotation proves it; anything else gets nothing:
  - strings: a string literal (parenthesized or not), a local declared from one and never
    assigned again (aliases followed), or a local or parameter annotated `---@type string` /
    `---@param x string`. `s:m()` and `s.m` are `string.m` (manual §6.4; LuaJIT's lib_string.c
    sets the same `__index`). A `string.m` the document defines is described by that definition.
  - tables: global paths (also through locals that alias them: `local w = worldScreen`,
    `local str = string`, `local g = _G`), locals declared from a table constructor and never
    assigned again, fields of them, the implicit `self` of `function T:m()` (as `T`), and values
    annotated `---@type Name` / `---@param x Name` for a `---@class Name` attached to
    `local Name = …` or `Name = …`. Members are the library and EEex-Docs names as before, then the
    functions the document stores in the table: `function T:m()`, `function T.f()`,
    `T.f = function`, and `{ f = function }` in the constructor of a local. They are a new hover
    target, `member`, rendered as `(method) function T:m(a)` / `(field) function T.f(a)` (labels
    localized in `l10n/server/`) with the doc comment above the definition
    (`functionDoc` in `src/server/docComments/attach.ts`); hovering the name in the definition
    shows the same. Semantic tokens type them `method` or `function`.
  - LuaJIT: `require("name")` with a literal name, when `require` is the global the document
    never assigns, is the module the library documents (`ffi`, `string.buffer`); its documented
    functions and methods that return a buffer object (`returns`, derived from the page's
    `buf = …` headings) make `buffer.new()` and chained calls typed.
  - Completion after `x:` / `x.` on a local offers by the same types; a local of no provable type
    still offers nothing.
  - `---@class` names are now parsed (`DocComment.className`; still not rendered). Same document
    only: definitions in other files are not followed (as for global hover). EEex game structures
    (`CGameSprite`, …) are documented by EEex-Docs as types without members, so `---@type
    CGameSprite` gives no member documentation.
- `scripts/lua-manual/convert.mts` accepts the LuaJIT documentation's HTML with
  `{ luajit: true }` (`</p>`, `<tt>`, `<i>`, `<br>`, tables, links to other pages, the
  external-link marker, colored code); the Lua 5.2 output is unchanged.

### Changed

- The Emscripten version is pinned once, in `third_party/emscripten.mts`, for both WebAssembly
  builds; CI reads it from there (was `third_party/lua52/build.mts`).
- `LuaChecker` (`src/server/validation/checker.ts`) replaces `Lua52Checker`; diagnostics take
  `checker(runtime)` instead of a single Lua 5.2 checker.
- New extension icon, `images/icon.png`: a d20 (a regular icosahedron) in the previous navy and
  gold palette, with a glowing "20" on the face toward the viewer. It is rendered by the rewritten
  `scripts/assets/icon.py` (Cycles on the GPU, seeded, 512 → 128 px) using Blender's bundled Inter
  font (OFL-1.1). The script now sets `use_nodes` only on Blender versions that need it, because
  Blender 5.2 deprecates it. CONTRIBUTING.md › The extension icon documents how to regenerate it.

## [1.0.0] - 2026-11-05

### Added

- Language server (separate Node process; IPC in VS Code, `--stdio` for other editors) with
  syntax diagnostics from the official Lua 5.2.4 compiler, built to WebAssembly from the
  checksum-verified lua.org tarball (`third_party/lua52/`, reproducible build checked in CI).
- `.menu` support: new `ie-menu` language (case-insensitive `.menu` extension), TextMate grammar
  that highlights the engine's keywords and embeds Lua where validation finds it, and validation of the Lua the engine compiles, found with a lexer
  that follows the engine's (per [IESDP](https://gibberlings3.github.io/iesdp/file_formats/ie_formats/menu_v1.htm)):
  `` `…` `` blocks; `onOpen`, `onClose` and `action*` scripts; and the expressions of `enabled`,
  `actionDrag`, `table`, `seperator`, `useOverlayTint`, `bitmap res` and every `lua` value. A value
  can be `"…"`, `'…'` or an unquoted word that is not a keyword, anywhere on a line. Each is
  compiled in the shape the engine compiles it: property code as the body of
  `function f () … end` (so `...` and a trailing `--` comment are errors), expressions as its
  `return` value, and `` `…` `` blocks without their last character, which the engine drops.
  `slotinfo`, `spellInfo` and `memorizedSpellInfo` strings are checked in every expression and
  statement the engine generates from them (`T.item.icon`, `Infinity_SwapSlot(T.id)`, …).
- `.menu` diagnostics for text the engine misreads (codes are stable): `menu-unterminated-string`
  for `"` and `'` strings, `menu-unterminated-block`, and the new `menu-word-too-long` (error: an
  unquoted word of 64 or more characters aborts the game), `menu-inline-lua-last-character`
  (warning: the character before a closing backtick is dropped) and `menu-unquoted-underscore`
  (warning: unquoted `My_Menu` is read as `My` and `Menu`).
- Settings `ieLua.validate.mode` (`manual`, `save` (default), `type`, `saveAndType`) and
  `ieLua.validate.debounce` (default 300 ms).
- Command **IE Lua: Validate Current File** (`ieLua.validateDocument`).
- Document symbols (`textDocument/documentSymbol`; outline, breadcrumbs, *Go to Symbol in
  Editor*): functions and methods at any depth, top-level locals, the first assignment to each
  global, and named table fields; in `.menu` files, each `menu` block by its `name`, holding the
  Lua symbols inside it. Flat `SymbolInformation` for clients without hierarchical support.
- Folding ranges (`textDocument/foldingRange`): function bodies, `do`/`while`/`for`/`repeat`,
  each `if`/`elseif`/`else` clause, multi-line tables, call arguments and long strings, long
  comments and runs of `--` lines; in `.menu` files every `{ … }` block, `` `…` `` blocks and
  `"…"` scripts, plus the Lua inside them. The closing line stays visible. Honors the client's
  `rangeLimit` and supported kinds.
- Go to definition (`textDocument/definition`): from any use of a local to its declaration, and
  from a global to every assignment to it (`x = …`, `function x()`), in the document and in
  every other `.lua` and `.menu` file of the workspace. The engine runs "in one global Lua state
  that is shared by the MENU file, the game's own Lua files and the engine"
  ([IESDP](https://gibberlings3.github.io/iesdp/file_formats/ie_formats/lua_globals.htm)), so a
  global is matched by name in every file; locals stay in their own chunk. No result for the
  implicit `self`, for globals no file assigns (game, EEex and library functions), or for table
  fields.
- Find references (`textDocument/references`), with the same matching as go to definition: the
  uses of a local, including the implicit `self` of a method, or every use of a global in the
  document and in the other files. `includeDeclaration` decides whether the local's
  declaration, or the assignments to the global, are included.
- Across files, for go to definition and find references: the other files are the open
  documents, whose unsaved text wins over the saved file, and the files of the workspace index
  (the files of workspace symbols, `files.exclude` honored). The document's own results come
  first, then the other files in URI order. A request waits for files still queued for
  indexing, and answers `ContentModified` (LSP 3.17) if the document changed meanwhile. `_ENV`,
  and names resolved through a local `_ENV` (fields of that table, Lua 5.2 manual §2.2), are not
  globals: they have no definition or references, in the document or elsewhere.
- Rename (`textDocument/prepareRename`, `textDocument/rename`) within the document, for locals
  and for globals the document assigns. Refused, with a reason localized in VS Code: anything
  that is not a variable (including `_ENV` and names resolved through a local `_ENV`), the
  implicit `self`, globals the document never assigns (defined in another file, the game or
  EEex), code with syntax errors where the variable can occur, new names that are not Lua names
  or are reserved words, and any rename that would change what a name
  refers to, including moving a name into or out of a local `_ENV` (checked by re-analyzing the
  renamed text). Edits are versioned when the client
  supports `documentChanges`.
- Workspace symbols (`workspace/symbol`; *Go to Symbol in Workspace*): the outline symbols of every
  `.lua` and `.menu` file (any letter case) in the `file:` workspace folders, and of every open
  document, whose unsaved text wins over the file. The query matches loosely (its characters in
  order, case-insensitively), as LSP recommends. Files are indexed in the background, one per
  event-loop turn, and kept current through watched-file events (`**/*.[lL][uU][aA]`,
  `**/*.[mM][eE][nN][uU]`, and creates and deletes of folders), workspace folder changes and
  document closes. `files.exclude` is honored as VS Code's explorer applies it, with an original
  matcher checked against VS Code's own; changing it rescans.
- Hover (`textDocument/hover`), in Markdown or plain text as the client prefers:
  - Lua 5.2 library functions, values and module tables, with the text of the
    [Lua 5.2 manual](https://www.lua.org/manual/5.2/manual.html) verbatim and a link to the entry:
    the basic functions and the `string`, `table`, `math`, `bit32` and `debug` libraries, the ones
    the engine opens (IESDP), also as `_G.string.format` and `("x"):rep()`. The text is generated
    from `doc/manual.html` of the checksum-verified Lua 5.2.4 tarball (`npm run lua-manual`, checked
    in CI) and is identical to the online manual's. `io`, `os`, `package` (`require`) and
    `coroutine` are not documented, as the engine does not provide them.
  - `print`: a note that the engine replaces it, linking IESDP's *Engine Lua globals*, instead of
    the manual's description.
  - EEex and game functions (`EEex_*`, `Infinity_*`, `C:AddGold`, also called as `C.AddGold`):
    the name and a link to EEex-Docs; no EEex-Docs text is copied.
  - Locals and globals of the document: how they are declared (`local function f(a, b)`,
    `(parameter) a`, `(for variable) i`, `(global) function G(x)`), from the first assignment for
    a global, shared across the Lua chunks of a `.menu` file.
  - No library text for names a local shadows (`local string = {}`), globals or library members the
    document assigns itself (`string = …`, `string.format = …`, `function string.trim()`), or names
    resolved through a local `_ENV`.
  - The server's own labels are localized into the 14 VS Code display languages from the client's
    `locale` (`InitializeParams.locale`), in every editor.
- Completion (`textDocument/completion`, `completionItem/resolve`; triggered by `.` and `:`), with
  the rules of hover so that a completed name hovers as offered:
  - Variables: the locals visible at the cursor (the innermost of each name, the implicit
    `self` included), then the globals the document assigns (in any Lua chunk of a `.menu` file),
    the Lua 5.2 library globals the engine opens, the EEex and game functions, and the keywords.
    Each name once, from the first of these that has it. While a local `_ENV` is visible, only
    locals and keywords. Keywords are the 22 reserved words (manual §3.1); in `.menu` expressions
    (`enabled "…"`, …) only `nil`, `false`, `true`, `function`, `not`, `and` and `or` (§3.4).
  - Members of globals (`_G.` prefixes removed): after `_G.` the globals; after `t.` and `t:` the
    fields the document assigns on `t`; the manual's members of `string`, `table`, `math`,
    `bit32` and `debug`, unless the document assigns the module table or defines that member;
    EEex-Docs names after the operator they are documented with (`EEex_Options_Option.new`,
    `C:AddGold`). After `("…"):`, the string library (§6.4). Nothing after locals, calls or
    indexes (no type inference).
  - Nothing in comments, strings and numbers, outside the Lua of a `.menu` file, or where a name
    is declared (after `local`, `function`, `for`, `goto`, `::`, in their name lists and in
    parameter lists). `io`, `os`, `package` (`require`) and `coroutine` are never offered.
  - Each item has the hover's code line as `detail`; the manual text or EEex-Docs link is added
    when the item is resolved, in Markdown or plain text as the client prefers
    (`completionItem.documentationFormat`). The edit range is the name around the cursor, sent
    once per list when the client supports `itemDefaults.editRange`, as an insert/replace edit
    when it supports `insertReplaceSupport`.
- Semantic tokens (`textDocument/semanticTokens/full`, `/full/delta` and `/range`) for the names
  in the Lua of `.lua` and `.menu` files, classified by the rules of hover so that a name is
  colored as it hovers. Keywords, literals, comments and `.menu` syntax are left to the TextMate
  grammars.
  - Types (all standard): `namespace`, `function`, `method`, `variable`, `parameter`, `property`,
    `label`. Modifiers: `declaration`, `modification`, `defaultLibrary`, and `global`, declared
    in the manifest (`contributes.semanticTokenModifiers`) so that themes can style `*.global`.
    No TextMate fallback scope is contributed: there is no conventional scope for globals, and
    the predefined fallbacks of the token types still apply.
  - Locals: parameters and the implicit `self` are `parameter`; `local function f`, and a local
    declared with a function expression and never assigned again, are `function`.
  - Globals have `global`. A global the document assigns is a `function` or `variable` from its
    first assignment; otherwise it takes its kind from the Lua 5.2 manual (`namespace` for the
    module tables) or EEex-Docs. `defaultLibrary` marks the manual's names, the engine's `print`
    and the *EE Game Lua Functions*, not EEex functions. `_ENV`, and names resolved through a
    local `_ENV`, are not globals.
  - Fields are `property`, or `method` after `:`; library and EEex-Docs members (`string.format`,
    `C:AddGold`) as documented. Assignment targets have `modification`, declared names
    `declaration`, labels are `label`.
- Formatting of `.lua` files (`textDocument/formatting`, `/rangeFormatting` and
  `/onTypeFormatting`), layout-preserving: only the white space between tokens and comments
  changes. `.menu` files are not formatted (no formatter is offered for them).
  - Line breaks are kept exactly as written; strings, long strings and long comments are never
    touched. Trailing white space is removed (also after a `--` comment) and blank lines are
    emptied.
  - Indentation by the constructs open at the start of each line (`function`, `do`, `then`,
    `else`, `repeat`, `(`, `[`, `{`), counted once per line that opens them (`f(function()` indents
    its body once); a line that starts with `end`, `until`, `else`, `elseif`, `)`, `]` or `}` is
    indented like the line that opened the construct; a line that continues a statement gets one
    more level. One level is a tab, or `tabSize` spaces with `insertSpaces`; a `tabSize` that is
    not an integer from 1 to 100 (the bounds of VS Code's `editor.tabSize`) is refused and logged.
  - Spacing within a line: one space around binary operators, `=` and keywords and after `,`/`;`;
    none inside `()`/`[]`, around `.`/`:`, after unary `-`/`#` or before the parentheses of a call
    or function; `{ a }` and `{}`; string and table call arguments (`f"x"`, `f{…}`) stay joined or
    apart as written; the space before a trailing comment is kept.
  - `insertFinalNewline` and `trimFinalNewlines` are honored for document formatting when the
    client sends `true`. No new settings.
  - A file with a syntax error is not formatted (the reason is logged); range and on-type
    formatting only refuse errors before the end of the lines they change.
  - On-type: after a line break the finished line is formatted (a blank new line keeps the
    editor's indentation); after the last character of `end`, `else`, `elseif`, `until`, `)`,
    `]` or `}` that starts a line, the line is re-indented. VS Code needs `editor.formatOnType`.
  - Every result is lexed again and must have the same tokens and comments, or nothing changes.
  - Registered dynamically for Lua documents only (language `lua`, or `*.lua` in any letter case)
    when the client supports it, so `.menu` files have no formatter; static otherwise.
- Quick fixes (`textDocument/codeAction`) for three `.menu` diagnostics, with the remedy
  [IESDP](https://gibberlings3.github.io/iesdp/file_formats/ie_formats/menu_v1.htm) states:
  - `menu-unquoted-underscore`: *Enclose in quotes* (`My_Menu` → `"My_Menu"`; "Always quote
    names"). A run without a letter (`10_0`) gets no fix: it is not a name, and quoting would
    make a number a string.
  - `menu-word-too-long`: *Enclose in quotes* ("Quoted strings are not limited"); the whole run
    when the word is joined to `_`.
  - `menu-inline-lua-last-character`: *Insert a space before the closing backtick* ("end every
    inline block with a line break or a space"), so the engine drops the space instead of code.
  - Each fix is preferred (`isPreferred`) and linked to its diagnostic; when the file has several
    problems of the code, *Fix all `<code>` problems* fixes them together.
  - `source.fixAll.ieLua` applies every fix of the file, also from `editor.codeActionsOnSave`
    (`{ "source.fixAll.ieLua": "explicit" }`) and whether or not diagnostics were published
    (`ieLua.validate.mode` `manual`). The kind is stable: settings refer to it.
  - No fix for `lua-syntax`, `menu-unterminated-string` or `menu-unterminated-block`: where the
    text should end, or how to repair the Lua, would be a guess.
  - The current text is analyzed again for every request: a diagnostic from an older version of
    the file (published on save, before later edits) gets no fix rather than an edit in the wrong
    place. Every set of edits is checked by lexing the result: the remaining problems must be
    exactly those no fix touches, or nothing is offered (and an error is logged).
  - The fixes change the Lua the engine compiles, as intended: the character it dropped before
    the backtick now runs, and a quoted property value is compiled whole (`enabled "My_Var"` is
    `My_Var`, not `My`). The Lua is validated as usual afterwards; it may report an error the
    dropped or split text hid.
  - Titles are localized like the hover labels. Advertised only to clients that accept
    `CodeAction` literals (`codeActionLiteralSupport`).
- LuaCATS doc comments ([annotation reference](https://luals.github.io/wiki/annotations/)) on the
  document's own code, in hover, completion and diagnostics. Types are shown as written; nothing checks or infers them.
  - A doc block is a run of `---` comments, each alone on its line, on consecutive lines; it
    documents the statement that starts on the next line. A blank line detaches it, and `----`
    banners and `---` after code are not doc comments. The reference does not state this rule;
    its examples follow it. The same applies inside the Lua of `.menu` files.
  - Documented: `local function f`, `local x = …` (one name), `function G()` and `G = …` (one
    name), a global by the block above its first assignment, as its hover code line already is.
    Each parameter shows its own `@param` entry, also for `function M.f(a)`, `function M:m(a)`
    and `M.f = function(a) … end`, whose names have no hover.
  - Rendered: the description (Markdown, one leading space removed from each line), then
    `@param`, `@return`, `@type`, `@deprecated` and `@see` in the order written, laid out as VS
    Code's own TypeScript hovers lay out JSDoc tags (``*@param* `name` — text``), with the type in
    a code span after the name. The other reference tags (`@class`, `@field`, `@overload`, …) and
    `---|` lines are not rendered and never show up as description. Tags are `---@tag`, as the
    reference writes them; `--- @tag` stays description text.
  - The code line of the hover, and the `detail` of a completion item, do not change.
  - Completion items of documented names carry the same text as their hover in `documentation`,
    sent with the list rather than on `completionItem/resolve`: the resolve request names no
    document, so a later lookup could read a newer version of it.
  - Diagnostics (warnings, published with the others under `ieLua.validate.mode`; codes are
    stable): `doc-tag-malformed` for `---@param` without a name or type and `---@return` or
    `---@type` without a type, in any doc block; `doc-param-unknown` for a `---@param` the
    documented function does not have (`...` needs a vararg function, `self` a method), checked
    only where the statement writes the function itself, never for a call result; and
    `doc-param-duplicate` for a parameter documented twice. Messages are localized like the hover
    labels.
- Error-tolerant Lua 5.2 parser and scope analysis (`src/server/syntax/`), checked against the
  official compiler by a differential test; it publishes no diagnostics of its own.
- Localization of the manifest, UI strings and the language server's hover labels into all 14 VS
  Code display languages (machine-produced; review welcome).
- Setup guides for Sublime Text, Neovim, Emacs, JetBrains IDEs, Helix, Zed, Kate, Notepad++ and Geany.
- EEex documentation index (`data/eeex/`): names and deep links only, synced from the published
  Read the Docs build.
- Repository tooling: CI, CodeQL, commit linting, Dependabot with auto-merge, release automation,
  EEex docs sync, issue and pull request templates.

### Changed

- The extension also activates in workspaces that contain `.lua` or `.menu` files, in any letter
  case (`workspaceContains:**/*.[lL][uU][aA]`, `workspaceContains:**/*.[mM][eE][nN][uU]`), so
  *Go to Symbol in Workspace* works before any file is opened.
- Minimum VS Code version is 1.91.0 (required by `vscode-languageclient` 10 and later).
- Versioning starts at 1.0.0: when no release exists yet, the Release workflow ships the
  committed `VERSION` as the first stable release (a pre-release before it would be 1.1.0).
- The Release workflow publishes only for merged `chore(release): …` pull requests, not for any
  other push that changes `VERSION`.
- The Release workflow records the installed size of each release for the README's install-size
  badge (`.github/badges/install-size.json`, a shields.io endpoint): the size VS Code shows in the
  extension's details, computed from the VSIX exactly as VS Code installs it
  (`scripts/release/vsix.mts`). CI checks it on release branches and the publish job against the
  VSIX it publishes; the exact byte count goes in the release notes.
- GitHub releases have the VSIX as their only asset; its SHA-256 moved from a separate
  `.vsix.sha256` file into the release notes, so the download count covers VSIX downloads only.
- CI integration jobs build the tests before running them, and a test run that finds no tests now
  fails. Until now the CI integration jobs ran 0 tests and passed.

### Security

Development tooling only; the extension's bundles are unchanged.

- `@azure/msal-node` (used by `@vscode/vsce` through `@azure/identity`) is 7.2.0, fixing
  [GHSA-xcx6-jx8p-x3h5](https://github.com/advisories/GHSA-xcx6-jx8p-x3h5).
- `serialize-javascript` in `@vscode/test-cli`'s mocha 11 is forced to 7.x with an npm override,
  fixing [GHSA-5c6j-r48x-rmvq](https://github.com/advisories/GHSA-5c6j-r48x-rmvq),
  [GHSA-qj8w-gfj5-8c6v](https://github.com/advisories/GHSA-qj8w-gfj5-8c6v) and
  [GHSA-m5mm-p8h7-m29v](https://github.com/advisories/GHSA-m5mm-p8h7-m29v). See CONTRIBUTING.md › Setup
  for when to remove it.
- The EEex docs sync script (`scripts/eeex-docs/sync.mts`) validates everything it fetches
  before using it: commits must be full SHAs, and every entry must be an identifier with a deep
  link inside the EEex documentation. Otherwise it stops without writing. It also reads the
  existing data file without a separate existence check (CodeQL `js/file-system-race`).


[Unreleased]: https://github.com/4Luke4/IE-Lua-Language-Server/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/4Luke4/IE-Lua-Language-Server/compare/v1.0.0...v1.2.0
[1.0.0]: https://github.com/4Luke4/IE-Lua-Language-Server/releases/tag/v1.0.0
