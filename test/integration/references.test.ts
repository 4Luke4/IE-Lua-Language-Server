import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, closeAllEditors, openFixture, starts } from './helpers.ts';

/** References as VS Code requests them (declarations included). */
async function referencesAt(file: string, line: number, character: number): Promise<string[]> {
  const uri = await openFixture(file);
  const found = await vscode.commands.executeCommand<vscode.Location[] | undefined>(
    'vscode.executeReferenceProvider',
    uri,
    new vscode.Position(line, character),
  );
  assert.ok(found, 'no reference provider answered');
  assert.ok(found.every((location) => location.uri.toString() === uri.toString()));
  return starts(found);
}

suite('Find references', () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  teardown(async () => {
    await closeAllEditors();
  });

  test('finds the declaration and every use of a local', async () => {
    assert.deepEqual(await referencesAt('navigation.lua', 1, 6), ['1:6', '4:1', '4:11', '5:8', '15:6']);
  });

  test('finds a global in every Lua chunk of a .menu file', async () => {
    assert.deepEqual(await referencesAt('NAVIGATION.MENU', 2, 0), ['2:0', '9:2', '13:11', '16:17', '17:3']);
  });
});
