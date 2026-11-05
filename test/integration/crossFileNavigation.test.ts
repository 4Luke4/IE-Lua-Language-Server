import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, closeAllEditors, fixtureUri, openFixture } from './helpers.ts';

/** `file line:character` of each location's start, with the file relative to `crossfile/`, sorted. */
function places(locations: readonly (vscode.Location | vscode.LocationLink)[]): string[] {
  const folder = `${fixtureUri('crossfile').toString()}/`;
  return locations
    .map((location) => {
      const [uri, range] = 'uri' in location ? [location.uri, location.range] : [location.targetUri, location.targetRange];
      const name = uri.toString().startsWith(folder) ? uri.toString().slice(folder.length) : uri.toString();
      return `${name} ${String(range.start.line)}:${String(range.start.character)}`;
    })
    .sort();
}

async function definitionsAt(uri: vscode.Uri, line: number, character: number): Promise<string[]> {
  const found = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[] | undefined>(
    'vscode.executeDefinitionProvider',
    uri,
    new vscode.Position(line, character),
  );
  assert.ok(found, 'no definition provider answered');
  return places(found);
}

/** References as VS Code requests them (declarations included). */
async function referencesAt(uri: vscode.Uri, line: number, character: number): Promise<string[]> {
  const found = await vscode.commands.executeCommand<vscode.Location[] | undefined>(
    'vscode.executeReferenceProvider',
    uri,
    new vscode.Position(line, character),
  );
  assert.ok(found, 'no reference provider answered');
  return places(found);
}

// VS Code orders the locations of several files itself, so they are compared sorted;
// the server's own order is covered by the unit tests.
suite('Cross-file navigation', () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  teardown(async () => {
    await closeAllEditors();
  });

  test('goes from a .MENU file to the definition of a global in a Lua file that is not open', async () => {
    const menu = await openFixture('crossfile/CROSSFILE.MENU');
    assert.deepEqual(await definitionsAt(menu, 9, 3), ['shared.lua 3:9']);
  });

  test('lists the assignments to a global in this file and in the other files', async () => {
    const lua = await openFixture('crossfile/shared.lua');
    assert.deepEqual(await definitionsAt(lua, 4, 19), ['CROSSFILE.MENU 10:3', 'shared.lua 1:0', 'shared.lua 4:1']);
  });

  test('finds the references of a global in every file of the workspace', async () => {
    const menu = await openFixture('crossfile/CROSSFILE.MENU');
    assert.deepEqual(await referencesAt(menu, 6, 11), [
      'CROSSFILE.MENU 10:3',
      'CROSSFILE.MENU 6:11',
      'shared.lua 1:0',
      'shared.lua 4:1',
      'shared.lua 4:19',
    ]);
  });

  test('uses the unsaved text of open documents', async () => {
    const lua = await openFixture('crossfile/shared.lua');
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor && editor.document.uri.toString() === lua.toString());
    await editor.edit((edit) => {
      edit.insert(new vscode.Position(1, 0), '\n');
    });
    try {
      const menu = await openFixture('crossfile/CROSSFILE.MENU');
      assert.deepEqual(await definitionsAt(menu, 9, 3), ['shared.lua 4:9']);
    } finally {
      await vscode.window.showTextDocument(lua);
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
  });
});
