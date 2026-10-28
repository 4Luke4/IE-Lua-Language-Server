# Geany

Uses the **LSP Client** plugin from [geany-plugins](https://plugins.geany.org/) 2.1 or later
([plugin README](https://github.com/geany/geany-plugins/blob/master/lsp/README)).
First complete [the common steps](README.md) to get `server.js`.

1. Enable *Tools › Plugin Manager › LSP Client*.
2. Make `.menu` files use the Lua file type: *Tools › Configuration Files › filetype_extensions.conf*,
   and in the `[Extensions]` section set

   ```ini
   Lua=*.lua;*.menu;*.MENU;
   ```

3. Open *Tools › LSP Client › User configuration* and add (or replace) the `[Lua]` section:

   ```ini
   [Lua]
   cmd=node /path/to/server.js --stdio
   use_outside_project_dir=true
   use_without_project=true
   initialization_options={"ieLua": {"validate": {"mode": "saveAndType"}}}
   ```

   `use_without_project` and `use_outside_project_dir` let the server run for files that are not
   part of a Geany project.
4. Open a `.lua` or `.menu` file; diagnostics are highlighted in the code, and hovering shows the
   message. They can also be listed in the message window.
