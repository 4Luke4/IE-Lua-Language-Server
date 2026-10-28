import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, closeAllEditors, fixtureUri } from './helpers.ts';

/** `kind name` per symbol, children indented, using VS Code's SymbolKind names. */
function outline(symbols: readonly vscode.DocumentSymbol[], depth = 0): string[] {
  return symbols.flatMap((s) => [`${'  '.repeat(depth)}${vscode.SymbolKind[s.kind]} ${s.name}`, ...outline(s.children, depth + 1)]);
}

async function symbolsOf(file: string): Promise<vscode.DocumentSymbol[]> {
  const uri = fixtureUri(file);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>('vscode.executeDocumentSymbolProvider', uri);
  assert.ok(symbols, 'no document symbol provider answered');
  return symbols;
}

suite('Document symbols', () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  teardown(async () => {
    await closeAllEditors();
  });

  test('outlines a Lua file hierarchically', async () => {
    const symbols = await symbolsOf('outline.lua');
    assert.deepEqual(outline(symbols), ['Variable settings', '  Field speed', '  Function reset', 'Method Panel:open']);
    const method = symbols[1];
    assert.ok(method);
    assert.equal(method.detail, '(id)');
    assert.deepEqual([method.range.start.line, method.range.end.line, method.selectionRange.start.character], [10, 16, 9]);
  });

  test('outlines .menu files by menu, with their Lua functions', async () => {
    const symbols = await symbolsOf('OUTLINE.MENU');
    assert.deepEqual(outline(symbols), ['Function helper', 'Namespace OUTLINE_MAIN']);
  });
});
