# Neovim

Uses the built-in LSP client and the `vim.lsp.config()` / `vim.lsp.enable()` API of
**Neovim 0.11 or later** ([`:help lsp-config`](https://neovim.io/doc/user/lsp.html)).
First complete [the common steps](README.md) to get `server.js`.

Add to your `init.lua`:

```lua
-- .menu files get their own file type (both spellings of the extension).
vim.filetype.add({ extension = { menu = 'iemenu', MENU = 'iemenu' } })

vim.lsp.config('ie_lua', {
  cmd = { 'node', '/path/to/server.js', '--stdio' },
  filetypes = { 'lua', 'iemenu' },
  root_markers = { '.git' },
  settings = {
    ieLua = { validate = { mode = 'saveAndType' } },
  },
})
vim.lsp.enable('ie_lua')
```

Open a `.lua` or `.menu` file and check that the server is attached with `:checkhealth vim.lsp`.
Diagnostics are shown with `vim.diagnostic` (for example `:lua vim.diagnostic.setqflist()`).
