import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, closeAllEditors, fixtureUri } from './helpers.ts';

async function foldsOf(file: string): Promise<string[]> {
  const uri = fixtureUri(file);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[] | undefined>('vscode.executeFoldingRangeProvider', uri);
  assert.ok(ranges, 'no folding range provider answered');
  return [...ranges]
    .sort((a, b) => a.start - b.start)
    .map((r) => `${r.start}-${r.end}${r.kind === vscode.FoldingRangeKind.Comment ? ' comment' : ''}`);
}

suite('Folding ranges', () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  teardown(async () => {
    await closeAllEditors();
  });

  test('folds Lua functions, clauses, tables and block comments', async () => {
    assert.deepEqual(await foldsOf('outline.lua'), ['1-3', '6-9 comment', '10-15', '11-12', '13-14']);
  });

  test('folds .menu blocks, Lua blocks, scripts and the Lua inside them', async () => {
    assert.deepEqual(await foldsOf('OUTLINE.MENU'), ['1-4', '2-3', '6-15', '9-14', '12-13']);
  });
});
