import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, closeAllEditors, fixtureUri, waitForDiagnostics, withSetting } from './helpers.ts';

const hasError = (diagnostics: vscode.Diagnostic[]): boolean =>
  diagnostics.some((d) => d.source === 'IE Lua' && d.severity === vscode.DiagnosticSeverity.Error);

suite('IE Lua Language Server', () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  teardown(async () => {
    await closeAllEditors();
  });

  test('registers the ieLua.validateDocument command', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('ieLua.validateDocument'));
  });

  test('detects .MENU files case-insensitively as ie-menu', async () => {
    const document = await vscode.workspace.openTextDocument(fixtureUri('BROKEN.MENU'));
    assert.equal(document.languageId, 'ie-menu');
  });

  test('validateDocument reports a Lua syntax error at the offending token', async () => {
    const uri = fixtureUri('broken.lua');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    const result = await vscode.commands.executeCommand<{ validated: boolean; diagnosticCount: number }>(
      'ieLua.validateDocument',
      uri,
    );
    assert.deepEqual(result, { validated: true, diagnosticCount: 1 });
    const [diagnostic] = await waitForDiagnostics(uri, hasError);
    assert.ok(diagnostic);
    assert.equal(diagnostic.code, 'lua-syntax');
    assert.equal(diagnostic.message, "syntax error near '1'");
    assert.deepEqual(
      [diagnostic.range.start.line, diagnostic.range.start.character, diagnostic.range.end.character],
      [2, 4, 5],
    );
  });

  test('validateDocument reports no problems for valid Lua', async () => {
    const uri = fixtureUri('valid.lua');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    const result = await vscode.commands.executeCommand('ieLua.validateDocument', uri);
    assert.deepEqual(result, { validated: true, diagnosticCount: 0 });
  });

  test('validateDocument validates Lua embedded in .menu files', async () => {
    const uri = fixtureUri('BROKEN.MENU');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    await vscode.commands.executeCommand('ieLua.validateDocument', uri);
    const diagnostics = await waitForDiagnostics(uri, hasError);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.range.start.line, 6);
  });

  test('validateDocument checks .menu Lua as the engine compiles and reads it', async () => {
    const uri = fixtureUri('MISREAD.MENU');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    await vscode.commands.executeCommand('ieLua.validateDocument', uri);
    const diagnostics = await waitForDiagnostics(uri, (found) => found.length === 2);
    assert.deepEqual(
      diagnostics
        .map((d) => [d.code, d.severity, d.range.start.line, d.range.start.character])
        .sort((a, b) => Number(a[2]) - Number(b[2])),
      [
        // The engine drops the `e` before the closing backtick.
        ['menu-inline-lua-last-character', vscode.DiagnosticSeverity.Warning, 2, 18],
        // `action` code is compiled as the body of a function that is not vararg.
        ['lua-syntax', vscode.DiagnosticSeverity.Error, 8, 31],
      ],
    );
  });

  test('"type" mode validates while editing', async () => {
    const restore = await withSetting('validate.mode', 'type');
    try {
      const document = await vscode.workspace.openTextDocument({ language: 'lua', content: 'local ok = 1\n' });
      const editor = await vscode.window.showTextDocument(document);
      await editor.edit((edit) => {
        edit.insert(new vscode.Position(1, 0), 'local = 2\n');
      });
      const diagnostics = await waitForDiagnostics(document.uri, hasError);
      assert.equal(diagnostics[0]?.range.start.line, 1);
    } finally {
      await restore();
    }
  });

  test('"save" mode validates on save', async () => {
    const uri = fixtureUri('.tmp', 'save-mode.lua');
    await vscode.workspace.fs.createDirectory(fixtureUri('.tmp'));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode('local ok = 1\n'));
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);
      await editor.edit((edit) => {
        edit.insert(new vscode.Position(1, 0), 'if then end\n');
      });
      assert.equal(await document.save(), true);
      const diagnostics = await waitForDiagnostics(uri, hasError);
      assert.equal(diagnostics[0]?.range.start.line, 1);
    } finally {
      await closeAllEditors();
      await vscode.workspace.fs.delete(fixtureUri('.tmp'), { recursive: true });
    }
  });
});
