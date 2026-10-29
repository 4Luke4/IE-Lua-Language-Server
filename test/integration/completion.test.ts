import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, closeAllEditors, openFixture } from './helpers.ts';

/**
 * The completion items offered just after the `occurrence`-th (0-based)
 * `needle` of a fixture, without VS Code's word-based suggestions (kind
 * `Text`), which every document gets. `resolve` items are resolved.
 */
async function completionsAfter(file: string, needle: string, { occurrence = 0, resolve = 0 } = {}): Promise<vscode.CompletionItem[]> {
  const uri = await openFixture(file);
  const document = await vscode.workspace.openTextDocument(uri);
  const text = document.getText();
  let offset = -1;
  for (let i = 0; i <= occurrence; i++) {
    offset = text.indexOf(needle, offset + 1);
    assert.ok(offset >= 0, `"${needle}" #${String(i)} not found in ${file}`);
  }
  const position = document.positionAt(offset + needle.length);
  const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', uri, position, undefined, resolve);
  return list.items.filter((item) => item.kind !== vscode.CompletionItemKind.Text);
}

const labelOf = (item: vscode.CompletionItem): string => (typeof item.label === 'string' ? item.label : item.label.label);
const labels = (items: readonly vscode.CompletionItem[]): string[] => items.map(labelOf);

function itemNamed(items: readonly vscode.CompletionItem[], label: string): vscode.CompletionItem {
  const found = items.find((item) => labelOf(item) === label);
  assert.ok(found, `no item "${label}" in ${labels(items).join(', ')}`);
  return found;
}

suite('Completion', () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  teardown(async () => {
    await closeAllEditors();
  });

  test('offers the locals in scope, document globals, library and game functions', async () => {
    const items = await completionsAfter('completion.lua', 'local line = prefix');
    const names = labels(items);
    assert.equal(itemNamed(items, 'prefix').detail, '(parameter) prefix');
    assert.equal(itemNamed(items, 'tally').detail, 'local function tally(items)');
    assert.equal(itemNamed(items, 'tally').kind, vscode.CompletionItemKind.Function);
    assert.equal(itemNamed(items, 'CompletionCounter').detail, '(global) CompletionCounter');
    assert.equal(itemNamed(items, 'string').kind, vscode.CompletionItemKind.Module);
    assert.equal(itemNamed(items, 'Infinity_DisplayString').detail, 'Infinity_DisplayString');
    assert.equal(itemNamed(items, 'while').kind, vscode.CompletionItemKind.Keyword);
    for (const absent of ['line', 'total', 'item', 'io', 'os', 'require', 'coroutine']) {
      assert.ok(!names.includes(absent), `"${absent}" should not be offered`);
    }
  });

  test('offers library members with the manual text when resolved', async () => {
    const items = await completionsAfter('completion.lua', 'string.', { resolve: 100 });
    assert.ok(!labels(items).includes('pairs'));
    const format = itemNamed(items, 'format');
    assert.equal(format.detail, 'string.format (formatstring, ···)');
    const documentation = format.documentation;
    assert.ok(documentation instanceof vscode.MarkdownString, 'expected Markdown documentation');
    assert.ok(documentation.value.startsWith('Returns a formatted version of its variable number of arguments'), documentation.value);
    assert.ok(documentation.value.endsWith('(https://www.lua.org/manual/5.2/manual.html#pdf-string.format)'), documentation.value);
  });

  test('offers game object methods after `:`', async () => {
    const items = await completionsAfter('completion.lua', 'C:');
    assert.equal(itemNamed(items, 'AddGold').kind, vscode.CompletionItemKind.Method);
    assert.ok(!labels(items).includes('format'));
  });

  test('offers nothing in comments and strings', async () => {
    assert.deepEqual(labels(await completionsAfter('completion.lua', '-- A comment mentioning pre')), []);
    assert.deepEqual(labels(await completionsAfter('completion.lua', '"pre')), []);
  });

  test('offers .menu globals across chunks, only inside the Lua', async () => {
    const statements = await completionsAfter('COMPLETION.MENU', 'onOpen "completion');
    assert.equal(itemNamed(statements, 'completionShown').detail, '(global) completionShown');
    const expression = await completionsAfter('COMPLETION.MENU', 'enabled "completion');
    assert.ok(labels(expression).includes('completionShown'));
    assert.ok(!labels(expression).includes('local'), 'statement keywords in an expression');
    assert.deepEqual(labels(await completionsAfter('COMPLETION.MENU', 'name')), []);
  });
});
