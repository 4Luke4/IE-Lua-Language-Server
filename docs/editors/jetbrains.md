# JetBrains IDEs (IntelliJ IDEA, PyCharm, WebStorm, …)

Uses the [LSP4IJ](https://github.com/redhat-developer/lsp4ij) plugin, which lets you add your own
language servers ([user guide](https://github.com/redhat-developer/lsp4ij/blob/main/docs/UserDefinedLanguageServer.md)).
First complete [the common steps](README.md) to get `server.js`.

1. Install **LSP4IJ** from *Settings › Plugins › Marketplace*.
2. Open *Settings › Languages & Frameworks › Language Servers* and click **[+]** to open the
   *New Language Server* dialog.
3. **Server** tab:
   - *Name:* `IE Lua`
   - *Command:* `node /path/to/server.js --stdio`
4. **Mappings** tab › *File name patterns*: add
   - `*.lua` with Language ID `lua`
   - `*.menu` with Language ID `ie-menu`
5. **Configuration** tab (optional):

   ```json
   { "ieLua": { "validate": { "mode": "saveAndType" } } }
   ```

6. Click **OK** and open a `.lua` or `.menu` file; errors are highlighted in the editor.
