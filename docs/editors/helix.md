# Helix

Uses the built-in LSP client ([Languages](https://docs.helix-editor.com/languages.html)).
First complete [the common steps](README.md) to get `server.js`.

Add to `languages.toml` in your Helix configuration folder (`~/.config/helix/` on Linux and macOS,
`%AppData%\helix\` on Windows):

```toml
[language-server.ie-lua]
command = "node"
args = ["/path/to/server.js", "--stdio"]
config = { ieLua = { validate = { mode = "saveAndType" } } }

# Use it for Lua files. This list replaces the default servers for Lua;
# add "lua-language-server" to it if you want to keep that one too.
[[language]]
name = "lua"
language-servers = ["ie-lua"]

# .menu files (both spellings of the extension).
[[language]]
name = "ie-menu"
scope = "source.ie-menu"
file-types = ["menu", "MENU"]
comment-token = "--"
language-servers = ["ie-lua"]
```

Run `hx --health` to check your configuration. Helix has no grammar for `.menu` files, so they
are shown without syntax highlighting, but diagnostics work.
