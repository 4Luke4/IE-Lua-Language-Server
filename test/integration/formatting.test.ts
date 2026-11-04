import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, closeAllEditors, openFixture } from './helpers.ts';

const OPTIONS: vscode.FormattingOptions = { tabSize: 2, insertSpaces: true };

/** The document text with `edits` applied, without changing the document. */
function applied(document: vscode.TextDocument, edits: readonly vscode.TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => document.offsetAt(b.range.start) - document.offsetAt(a.range.start));
  let text = document.getText();
  for (const edit of sorted) {
    text = text.slice(0, document.offsetAt(edit.range.start)) + edit.newText + text.slice(document.offsetAt(edit.range.end));
  }
  return text;
}

async function open(file: string): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument(await openFixture(file));
}

suite('Formatting', () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  teardown(async () => {
    await closeAllEditors();
  });

  test('formats a Lua document, keeping its lines and comments', async () => {
    const document = await open('format.lua');
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>('vscode.executeFormatDocumentProvider', document.uri, OPTIONS);
    assert.ok(edits && edits.length > 0, 'no formatting provider answered');
    assert.equal(
      applied(document, edits),
      [
        '-- Original fixture: formatting. Deliberately unformatted.',
        'local function fmtScale(value, factor)',
        '  local result = value * factor',
        '  if result > 10 then',
        '    return -result',
        '  else',
        '    return result',
        '  end',
        'end',
        '',
        'FmtTable = { 1, 2; name = "n", ["k"] = fmtScale(2, 3) }',
        '',
      ].join('\n'),
    );
  });

  test('formats only the lines of a range', async () => {
    const document = await open('format.lua');
    const range = new vscode.Range(3, 0, 3, 5);
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>('vscode.executeFormatRangeProvider', document.uri, range, OPTIONS);
    assert.ok(edits && edits.length > 0, 'no range formatting provider answered');
    assert.deepEqual(new Set(edits.map((edit) => edit.range.start.line)), new Set([3]));
    assert.equal(applied(document, edits).split('\n')[3], '  if result > 10 then');
  });

  test('re-indents a line whose first token, a closer, was just typed', async () => {
    const document = await open('format.lua');
    // Line 5 is `    else`: as if its last character had just been typed.
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>(
      'vscode.executeFormatOnTypeProvider',
      document.uri,
      new vscode.Position(5, 8),
      'e',
      OPTIONS,
    );
    assert.ok(edits, 'no on-type formatting provider answered');
    assert.equal(edits.length, 1);
    assert.equal(applied(document, edits).split('\n')[5], '  else');
  });

  test('offers no formatter for .menu files', async () => {
    const document = await open('OUTLINE.MENU');
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>('vscode.executeFormatDocumentProvider', document.uri, OPTIONS);
    assert.ok(edits === undefined || edits.length === 0, `unexpected edits: ${JSON.stringify(edits)}`);
  });
});
