import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { DIAGNOSTIC_SOURCE, FIX_ALL_KIND } from '../../src/shared/protocol.ts';
import { activateExtension, closeAllEditors, fixtureUri, openFixture, waitForDiagnostics } from './helpers.ts';

/** The code actions VS Code collects for `range` of `uri`, of `kind` when given. */
async function actionsAt(uri: vscode.Uri, range: vscode.Range, kind?: string): Promise<vscode.CodeAction[]> {
  const found = await vscode.commands.executeCommand<(vscode.CodeAction | vscode.Command)[] | undefined>(
    'vscode.executeCodeActionProvider',
    uri,
    range,
    kind,
  );
  return (found ?? []).filter((action): action is vscode.CodeAction => 'kind' in action || 'edit' in action);
}

/** `line:character newText` of each edit of `uri`, in document order. */
function editsOf(edit: vscode.WorkspaceEdit | undefined, uri: vscode.Uri): string[] {
  return (edit?.get(uri) ?? []).map(({ range, newText }) => `${String(range.start.line)}:${String(range.start.character)} ${newText}`);
}

suite('Code actions', () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  teardown(async () => {
    await closeAllEditors();
  });

  /** QUICKFIX.MENU, validated, with its diagnostics. */
  async function quickFixFixture(): Promise<{ uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }> {
    const uri = await openFixture('QUICKFIX.MENU');
    await vscode.commands.executeCommand('ieLua.validateDocument', uri);
    const diagnostics = await waitForDiagnostics(uri, (found) => found.length === 3);
    return { uri, diagnostics };
  }

  test('offers a preferred quick fix that quotes a name with "_", and one that quotes every such name', async () => {
    const { uri, diagnostics } = await quickFixFixture();
    const underscore = diagnostics.find((d) => d.code === 'menu-unquoted-underscore' && d.range.start.line === 5);
    assert.ok(underscore, 'no diagnostic for name Quick_Fix');
    assert.equal(underscore.source, DIAGNOSTIC_SOURCE);
    const actions = (await actionsAt(uri, underscore.range)).filter((action) => action.kind?.value === 'quickfix');
    assert.deepEqual(
      actions.map((action) => [action.title, action.isPreferred === true, editsOf(action.edit, uri)]),
      [
        ['Enclose in quotes', true, ['5:6 "Quick_Fix"']],
        ['Fix all menu-unquoted-underscore problems', false, ['5:6 "Quick_Fix"', '9:7 "Another_Name"']],
      ],
    );
  });

  test('offers a quick fix that inserts a space before a closing backtick', async () => {
    const { uri, diagnostics } = await quickFixFixture();
    const inline = diagnostics.find((d) => d.code === 'menu-inline-lua-last-character');
    assert.ok(inline, 'no diagnostic for the inline Lua block');
    const actions = (await actionsAt(uri, inline.range)).filter((action) => action.kind?.value === 'quickfix');
    assert.deepEqual(
      actions.map((action) => [action.title, editsOf(action.edit, uri)]),
      [['Insert a space before the closing backtick', ['2:19  ']]],
    );
  });

  test('fixes every fixable problem with source.fixAll.ieLua, without published diagnostics', async () => {
    const document = await vscode.workspace.openTextDocument({ language: 'ie-menu', content: 'name My_Menu\n`x = 1`\n' });
    await vscode.window.showTextDocument(document);
    const whole = new vscode.Range(0, 0, document.lineCount, 0);
    const [fixAll, ...others] = await actionsAt(document.uri, whole, FIX_ALL_KIND);
    assert.ok(fixAll?.edit, 'no fix-all action');
    assert.deepEqual(others, []);
    assert.equal(fixAll.kind?.value, FIX_ALL_KIND);
    assert.equal(fixAll.title, 'Fix all IE Lua auto-fixable problems');
    assert.ok(await vscode.workspace.applyEdit(fixAll.edit));
    assert.equal(document.getText(), 'name "My_Menu"\n`x = 1 `\n');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });

  test('offers no IE Lua code actions for Lua files', async () => {
    const uri = fixtureUri('valid.lua');
    await openFixture('valid.lua');
    const actions = await actionsAt(uri, new vscode.Range(0, 0, 1, 0), 'source');
    assert.deepEqual(actions.filter((action) => action.kind?.value === FIX_ALL_KIND), []);
  });
});
