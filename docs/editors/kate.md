# Kate

Uses the bundled **LSP Client** plugin
([Kate handbook](https://docs.kde.org/stable_kf6/en/kate/kate/kate-application-plugin-lspclient.html)).
First complete [the common steps](README.md) to get `server.js`.

1. Enable the plugin in *Settings › Configure Kate › Plugins › LSP Client*.
2. Open *Settings › Configure Kate › LSP Client › User Server Settings* and enter:

   ```json
   {
     "servers": {
       "lua": {
         "command": ["node", "/path/to/server.js", "--stdio"],
         "highlightingModeRegex": "^Lua$"
       }
     }
   }
   ```

   This replaces Kate's default server for the *Lua* highlighting mode.
3. Make `.menu` files use the Lua mode: *Settings › Configure Kate › Open/Save › Modes & Filetypes*,
   select *Scripts › Lua* and add `*.menu;*.MENU` to *File extensions*.

Kate's handbook does not document a way to send server settings from this file, so the server
uses its defaults and **updates diagnostics when you save**.
