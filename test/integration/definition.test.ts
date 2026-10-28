import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, closeAllEditors, openFixture, starts } from './helpers.ts';

async function definitionsAt(file: string, line: number, character: number): Promise<string[]> {
  const uri = await openFixture(file);
  const found = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[] | undefined>(
    'vscode.executeDefinitionProvider',
    uri,
    new vscode.Position(line, character),
  );
  assert.ok(found, 'no definition provider answered');
  return starts(found);
}

suite('Go to definition', () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  teardown(async () => {
    await closeAllEditors();
  });

  test('goes from a use of a local to its declaration', async () => {
    assert.deepEqual(await definitionsAt('navigation.lua', 15, 6), ['1:6']);
  });

  test('goes from a call of a global function to its definition', async () => {
    assert.deepEqual(await definitionsAt('navigation.lua', 14, 0), ['3:9']);
  });

  test('has no definition for the implicit self', async () => {
    assert.deepEqual(await definitionsAt('navigation.lua', 11, 8), []);
  });

  test('lists every assignment to a global across the Lua of a .menu file', async () => {
    assert.deepEqual(await definitionsAt('NAVIGATION.MENU', 13, 11), ['2:0', '9:2', '17:3']);
  });
});
