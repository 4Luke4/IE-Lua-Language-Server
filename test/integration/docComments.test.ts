import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, closeAllEditors, openFixture, waitForDiagnostics } from './helpers.ts';

/** The position of the `occurrence`-th (0-based) `needle` of an open document. */
function positionOf(document: vscode.TextDocument, needle: string, occurrence = 0): vscode.Position {
  const text = document.getText();
  let offset = -1;
  for (let i = 0; i <= occurrence; i++) {
    offset = text.indexOf(needle, offset + 1);
    assert.ok(offset >= 0, `"${needle}" #${String(i)} not found`);
  }
  return document.positionAt(offset);
}

/** The Markdown hover text at the `occurrence`-th `needle` of a fixture. */
async function hoverAt(file: string, needle: string, occurrence = 0): Promise<string> {
  const uri = await openFixture(file);
  const document = await vscode.workspace.openTextDocument(uri);
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, positionOf(document, needle, occurrence));
  return hovers
    .flatMap((hover) =>
      hover.contents.map((content) => {
        assert.ok(content instanceof vscode.MarkdownString, 'expected Markdown hover content');
        return content.value;
      }),
    )
    .join('\n');
}

suite('Doc comments', () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  teardown(async () => {
    await closeAllEditors();
  });

  test('hover shows the doc comment of a local function and the @param entry of its parameter', async () => {
    assert.equal(
      await hoverAt('doccomments.lua', 'greet(name, times)'),
      '```lua\nlocal function greet(name, times)\n```\n\n---\n\nBuilds a greeting.\n\n' +
        '*@param* `name` `string` — Who to greet.  \n\n*@param* `times?` `integer`  \n\n*@return* `string` `greeting` — The text.',
    );
    assert.equal(await hoverAt('doccomments.lua', 'times or'), '```lua\n(parameter) times\n```\n\n---\n\n*@param* `times?` `integer`');
  });

  test('hover documents a global by the doc comment of its first assignment, also in .menu files', async () => {
    assert.equal(await hoverAt('doccomments.lua', 'DocCounter', 2), '```lua\n(global) DocCounter\n```\n\n---\n\n*@type* `integer`');
    assert.equal(
      await hoverAt('DOCCOMMENTS.MENU', 'DocOpen', 1),
      '```lua\n(global) function DocOpen(force)\n```\n\n---\n\nOpens the doc menu.\n\n*@param* `force` `boolean`',
    );
  });

  test('completion items of documented names carry the doc comment', async () => {
    const uri = await openFixture('doccomments.lua');
    const document = await vscode.workspace.openTextDocument(uri);
    // Inside `greet` in `return greet(name)`, where greet is visible.
    const position = positionOf(document, 'greet(name)').translate(0, 2);
    const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', uri, position);
    const greet = list.items.find((item) => item.label === 'greet' || (typeof item.label === 'object' && item.label.label === 'greet'));
    assert.ok(greet, 'no greet item');
    const documentation = greet.documentation;
    assert.ok(documentation instanceof vscode.MarkdownString, 'expected Markdown documentation');
    assert.ok(documentation.value.startsWith('Builds a greeting.\n\n*@param* `name` `string` — Who to greet.'), documentation.value);
  });

  test('validation reports doc comment problems with their codes', async () => {
    const uri = await openFixture('doccomments.lua');
    const document = await vscode.workspace.openTextDocument(uri);
    const result = await vscode.commands.executeCommand<{ validated: boolean; diagnosticCount: number }>('ieLua.validateDocument', uri);
    assert.equal(result.validated, true);
    const diagnostics = await waitForDiagnostics(uri, (found) => found.length === 3);
    const summary = diagnostics.map((diagnostic) => [diagnostic.code, document.getText(diagnostic.range), diagnostic.severity]);
    assert.deepEqual(summary, [
      ['doc-param-unknown', 'missing', vscode.DiagnosticSeverity.Warning],
      ['doc-param-duplicate', 'name', vscode.DiagnosticSeverity.Warning],
      ['doc-tag-malformed', '@return', vscode.DiagnosticSeverity.Warning],
    ]);
    assert.ok(diagnostics.every((diagnostic) => diagnostic.source === 'IE Lua'));
  });
});
