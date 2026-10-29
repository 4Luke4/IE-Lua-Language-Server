import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, closeAllEditors, fixtureUri, openFixture, waitForWorkspaceSymbols } from './helpers.ts';

const encoder = new TextEncoder();
const names = (symbols: readonly vscode.SymbolInformation[]): string[] => symbols.map((s) => s.name);
const has = (name: string) => (symbols: readonly vscode.SymbolInformation[]): boolean => names(symbols).includes(name);
const lacks = (name: string) => (symbols: readonly vscode.SymbolInformation[]): boolean => !names(symbols).includes(name);

suite('Workspace symbols', () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  teardown(async () => {
    await closeAllEditors();
  });

  test('finds symbols in files that were never opened', async () => {
    const symbols = await waitForWorkspaceSymbols('fixtureNeverOpened', has('fixtureNeverOpened'));
    const found = symbols.find((s) => s.name === 'fixtureNeverOpened');
    assert.ok(found);
    assert.equal(found.location.uri.toString(), fixtureUri('symbols', 'never-opened.lua').toString());
    assert.equal(found.location.range.start.line, 1);
    assert.equal(found.kind, vscode.SymbolKind.Function);
  });

  test('finds the menus of .MENU files by name, and the Lua symbols in them', async () => {
    const menu = fixtureUri('OUTLINE.MENU').toString();
    const inMenu = (found: readonly vscode.SymbolInformation[]): string[] =>
      found.filter((s) => s.location.uri.toString() === menu).map((s) => `${vscode.SymbolKind[s.kind]} ${s.name}`);
    const symbols = await waitForWorkspaceSymbols('', (found) => inMenu(found).length > 0);
    // VS Code orders workspace symbols itself, so compare them sorted.
    assert.deepEqual(inMenu(symbols).sort(), ['Function helper', 'Namespace OUTLINE_MAIN']);
  });

  test('matches the query loosely: its characters in order, in any case', async () => {
    const symbols = await waitForWorkspaceSymbols('fxnvropnd', has('fixtureNeverOpened'));
    assert.ok(!names(symbols).includes('fixtureExcludedSymbol'));
  });

  test('uses the unsaved text of open documents', async () => {
    const uri = await openFixture('symbols/never-opened.lua');
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor && editor.document.uri.toString() === uri.toString());
    await editor.edit((edit) => {
      edit.insert(new vscode.Position(3, 0), 'function fixtureUnsavedEdit()\nend\n');
    });
    await waitForWorkspaceSymbols('fixtureUnsavedEdit', has('fixtureUnsavedEdit'));
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    // Closing re-reads the saved file, which never had the edit.
    await waitForWorkspaceSymbols('fixtureUnsavedEdit', lacks('fixtureUnsavedEdit'));
  });

  test('indexes .lua and .MENU files created and deleted outside the editor', async () => {
    const folder = fixtureUri('.tmp');
    const lua = vscode.Uri.joinPath(folder, 'created.lua');
    const menu = vscode.Uri.joinPath(folder, 'CREATED.MENU');
    await vscode.workspace.fs.createDirectory(folder);
    try {
      await vscode.workspace.fs.writeFile(lua, encoder.encode('function fixtureCreatedLua()\nend\n'));
      await vscode.workspace.fs.writeFile(menu, encoder.encode('`\nfunction fixtureCreatedMenu() end\n`\n'));
      await waitForWorkspaceSymbols('fixtureCreated', (found) => has('fixtureCreatedLua')(found) && has('fixtureCreatedMenu')(found));
      await vscode.workspace.fs.delete(lua);
      await waitForWorkspaceSymbols('fixtureCreated', lacks('fixtureCreatedLua'));
    } finally {
      await vscode.workspace.fs.delete(folder, { recursive: true });
    }
    await waitForWorkspaceSymbols('fixtureCreated', lacks('fixtureCreatedMenu'));
  });

  test('honors files.exclude, and follows changes to it', async () => {
    await waitForWorkspaceSymbols('fixtureExcludedSymbol', has('fixtureExcludedSymbol'));
    const files = vscode.workspace.getConfiguration('files');
    const previous = files.inspect('exclude')?.workspaceValue;
    await files.update('exclude', { '**/excluded': true }, vscode.ConfigurationTarget.Workspace);
    try {
      await waitForWorkspaceSymbols('fixtureExcludedSymbol', lacks('fixtureExcludedSymbol'));
    } finally {
      await vscode.workspace.getConfiguration('files').update('exclude', previous, vscode.ConfigurationTarget.Workspace);
    }
    await waitForWorkspaceSymbols('fixtureExcludedSymbol', has('fixtureExcludedSymbol'));
  });
});
