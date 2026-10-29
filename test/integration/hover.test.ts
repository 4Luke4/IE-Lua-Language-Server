import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, closeAllEditors, openFixture } from './helpers.ts';

/**
 * The hover text at the `occurrence`-th (0-based) `needle` of a fixture, or
 * `undefined` when no provider has anything to say.
 */
async function hoverAt(file: string, needle: string, occurrence = 0): Promise<string | undefined> {
  const uri = await openFixture(file);
  const document = await vscode.workspace.openTextDocument(uri);
  const text = document.getText();
  let offset = -1;
  for (let i = 0; i <= occurrence; i++) {
    offset = text.indexOf(needle, offset + 1);
    assert.ok(offset >= 0, `"${needle}" #${String(i)} not found in ${file}`);
  }
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, document.positionAt(offset));
  // The server sends MarkupContent, which the client turns into a MarkdownString.
  const values = hovers.flatMap((hover) =>
    hover.contents.map((content) => {
      assert.ok(content instanceof vscode.MarkdownString, 'expected Markdown hover content');
      return content.value;
    }),
  );
  return values.length === 0 ? undefined : values.join('\n');
}

suite('Hover', () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  teardown(async () => {
    await closeAllEditors();
  });

  test('quotes the Lua 5.2 manual for a library function, with a link to it', async () => {
    const value = await hoverAt('hover.lua', 'format');
    assert.ok(value, 'no hover');
    assert.ok(value.startsWith('```lua\nstring.format (formatstring, ···)\n```'), value);
    assert.ok(value.includes('Returns a formatted version of its variable number of arguments'), value);
    assert.ok(value.endsWith('[Lua 5.2 Reference Manual, §6.4 – String Manipulation](https://www.lua.org/manual/5.2/manual.html#pdf-string.format)'), value);
  });

  test('describes locals by their declaration', async () => {
    assert.equal(await hoverAt('hover.lua', 'greet', 1), '```lua\nlocal function greet(name, ...)\n```');
    assert.equal(await hoverAt('hover.lua', 'name', 1), '```lua\n(parameter) name\n```');
    assert.equal(await hoverAt('hover.lua', 'index', 1), '```lua\n(for variable) index\n```');
    assert.equal(await hoverAt('hover.lua', 'Refresh'), '```lua\n(global) function Refresh(force)\n```');
  });

  test('says that the engine replaces print instead of quoting the manual', async () => {
    const value = await hoverAt('hover.lua', 'print');
    assert.ok(value, 'no hover');
    assert.ok(value.includes('The game engine replaces `print` with its own function'), value);
    assert.ok(value.includes('(https://gibberlings3.github.io/iesdp/file_formats/ie_formats/lua_globals.htm)'), value);
  });

  test('links game functions to EEex-Docs', async () => {
    const value = await hoverAt('hover.lua', 'Infinity_DisplayString');
    assert.match(value ?? '', /^```lua\nInfinity_DisplayString\n```\n\n---\n\n\[EE Game Lua Functions\]\(https:\/\/eeex-docs\.readthedocs\.io\//);
  });

  test('gives no library documentation for a shadowed library table, nor any hover on keywords', async () => {
    assert.equal(await hoverAt('hover.lua', 'format', 2), undefined);
    assert.equal(await hoverAt('hover.lua', 'string', 2), '```lua\nlocal string\n```');
    assert.equal(await hoverAt('hover.lua', 'local'), undefined);
  });

  test('describes a .menu global by its assignment in another chunk', async () => {
    assert.equal(await hoverAt('HOVER.MENU', 'hoverCount', 2), '```lua\n(global) hoverCount\n```');
    const value = await hoverAt('HOVER.MENU', 'rep');
    assert.ok(value, 'no hover');
    assert.ok(value.startsWith('```lua\nstring.rep (s, n [, sep])\n```'), value);
  });
});
