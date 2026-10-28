# Notepad++

Notepad++ has no built-in LSP client. Use the third-party
[NppLspClient](https://github.com/Ekopalypse/NppLspClient) plugin (Notepad++ 8.7.7 or later).
First complete [the common steps](README.md) to get `server.js`.

1. Download the NppLspClient ZIP for your Notepad++ (32- or 64-bit) from its
   [releases](https://github.com/Ekopalypse/NppLspClient/releases) and unpack it into
   `Notepad++\plugins`, then restart Notepad++.
2. Choose *Plugins › NppLspClient › Open configuration* and add:

   ```toml
   [lspservers.lua]
   mode = "io"
   executable = 'C:\Program Files\nodejs\node.exe'
   args = 'C:\Tools\ie-lua-language-server\server.js --stdio'
   auto_start_server = false
   ```

   Adjust both paths to your installation. Prefer a folder **without spaces** for `server.js`.
3. Make `.menu` files open as Lua: *Settings › Style Configurator › Language: Lua*, add `menu` to
   *User ext.* and click *Save & Close*.
4. Open a `.lua` or `.menu` file and choose *Plugins › NppLspClient › Start server for current language*.
