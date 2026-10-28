# Sublime Text

Uses the [LSP](https://github.com/sublimelsp/LSP) package. First complete
[the common steps](README.md) to get `server.js`.

1. Install the **LSP** package with Package Control (*Tools › Command Palette › Package Control: Install Package › LSP*).
2. Open *Preferences › Package Settings › LSP › Server Configurations*
   (Command Palette: `Preferences: LSP Server Configurations`). This edits
   `Packages/User/LanguageServers.sublime-settings`.
3. Add the server:

   ```jsonc
   {
     "ie-lua": {
       "enabled": true,
       "command": ["node", "/path/to/server.js", "--stdio"],
       "selector": "source.lua",
       "settings": {
         "ieLua": { "validate": { "mode": "saveAndType" } }
       }
     }
   }
   ```

4. Make `.menu` files use the Lua syntax so that the `source.lua` selector matches them: open a
   `.menu` file and choose *View › Syntax › Open all with current extension as… › Lua*.

Errors are highlighted in the file; hover over them for the message.
