import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { RENAME_REFUSAL_MESSAGES } from '../../src/shared/protocol.ts';
import { activateExtension, closeAllEditors, openFixture } from './helpers.ts';

/** `line:character newText` of each edit of `uri`, in document order. */
function editsOf(edit: vscode.WorkspaceEdit, uri: vscode.Uri): string[] {
  return edit
    .get(uri)
    .map(({ range, newText }) => `${String(range.start.line)}:${String(range.start.character)} ${newText}`)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

async function renameAt(file: string, line: number, character: number, newName: string): Promise<{ uri: vscode.Uri; edit: vscode.WorkspaceEdit }> {
  const uri = await openFixture(file);
  const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit | undefined>(
    'vscode.executeDocumentRenameProvider',
    uri,
    new vscode.Position(line, character),
    newName,
  );
  assert.ok(edit, 'no rename provider answered');
  return { uri, edit };
}

/** The message a rejected command fails with. */
async function rejection(command: Thenable<unknown>): Promise<string> {
  try {
    await command;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  assert.fail('the command did not fail');
}

suite('Rename', () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  teardown(async () => {
    await closeAllEditors();
  });

  test('prepares the rename of a local with its range and name', async () => {
    const uri = await openFixture('navigation.lua');
    const result = await vscode.commands.executeCommand<{ range: vscode.Range; placeholder: string } | undefined>(
      'vscode.prepareRename',
      uri,
      new vscode.Position(15, 8),
    );
    assert.ok(result, 'no rename provider answered');
    assert.equal(result.placeholder, 'counter');
    assert.deepEqual([result.range.start.line, result.range.start.character, result.range.end.character], [15, 6, 13]);
  });

  test('renames the declaration and every use of a local', async () => {
    const { uri, edit } = await renameAt('navigation.lua', 1, 6, 'total');
    assert.deepEqual(editsOf(edit, uri), ['1:6 total', '4:1 total', '4:11 total', '5:8 total', '15:6 total']);
  });

  test('renames a global in every Lua chunk of a .menu file', async () => {
    const { uri, edit } = await renameAt('NAVIGATION.MENU', 9, 2, 'chosen');
    assert.deepEqual(editsOf(edit, uri), ['2:0 chosen', '9:2 chosen', '13:11 chosen', '16:17 chosen', '17:3 chosen']);
  });

  test('refuses globals defined outside the file, with the reason', async () => {
    const uri = await openFixture('navigation.lua');
    const message = await rejection(vscode.commands.executeCommand('vscode.prepareRename', uri, new vscode.Position(15, 0)));
    assert.equal(message, RENAME_REFUSAL_MESSAGES.globalNotDefinedHere);
  });

  test('refuses a new name that is a reserved word, with the reason', async () => {
    const message = await rejection(renameAt('navigation.lua', 1, 6, 'end'));
    assert.equal(message, RENAME_REFUSAL_MESSAGES.reservedWord);
  });
});
