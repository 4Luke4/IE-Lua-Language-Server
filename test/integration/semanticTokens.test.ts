import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, closeAllEditors, openFixture } from './helpers.ts';

/** Decodes LSP-encoded tokens into `text type modifier,modifier` entries, in order. */
function decode(document: vscode.TextDocument, legend: vscode.SemanticTokensLegend, tokens: vscode.SemanticTokens): string[] {
  const out: string[] = [];
  const data = tokens.data;
  let line = 0;
  let character = 0;
  for (let i = 0; i + 4 < data.length; i += 5) {
    const deltaLine = data[i] ?? 0;
    line += deltaLine;
    character = deltaLine === 0 ? character + (data[i + 1] ?? 0) : (data[i + 1] ?? 0);
    const start = new vscode.Position(line, character);
    const text = document.getText(new vscode.Range(start, start.translate(0, data[i + 2] ?? 0)));
    const bits = data[i + 4] ?? 0;
    const modifiers = legend.tokenModifiers.filter((_, bit) => (bits & (1 << bit)) !== 0);
    out.push(`${text} ${legend.tokenTypes[data[i + 3] ?? -1] ?? '?'} ${modifiers.join(',')}`.trimEnd());
  }
  return out;
}

async function tokensOf(file: string, range?: (document: vscode.TextDocument) => vscode.Range): Promise<string[]> {
  const uri = await openFixture(file);
  const document = await vscode.workspace.openTextDocument(uri);
  const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend | undefined>(
    range ? 'vscode.provideDocumentRangeSemanticTokensLegend' : 'vscode.provideDocumentSemanticTokensLegend',
    uri,
  );
  assert.ok(legend, 'no semantic tokens legend');
  const tokens = range
    ? await vscode.commands.executeCommand<vscode.SemanticTokens | undefined>('vscode.provideDocumentRangeSemanticTokens', uri, range(document))
    : await vscode.commands.executeCommand<vscode.SemanticTokens | undefined>('vscode.provideDocumentSemanticTokens', uri);
  assert.ok(tokens, 'no semantic tokens provider answered');
  return decode(document, legend, tokens);
}

suite('Semantic tokens', () => {
  suiteSetup(async () => {
    await activateExtension();
  });

  teardown(async () => {
    await closeAllEditors();
  });

  test('classifies the names of a Lua file', async () => {
    assert.deepEqual(await tokensOf('semantic.lua'), [
      'scale function declaration',
      'value parameter declaration',
      'factor parameter declaration',
      'result variable declaration',
      'value parameter',
      'factor parameter',
      'result variable',
      'SemanticTotal variable modification,global',
      'scale function',
      'label variable declaration',
      'string namespace defaultLibrary,global',
      'format function defaultLibrary',
      'SemanticTotal variable global',
      'Infinity_DisplayString function defaultLibrary,global',
      'label variable',
    ]);
  });

  test('classifies only the Lua of a .menu file, with its globals shared across chunks', async () => {
    assert.deepEqual(await tokensOf('SEMANTIC.MENU'), [
      'SemanticShow function modification,global',
      'count parameter declaration',
      'count parameter',
      'SemanticShow function global',
    ]);
  });

  test('returns the tokens of a range', async () => {
    const tokens = await tokensOf('semantic.lua', (document) => document.lineAt(7).range);
    assert.deepEqual(tokens, [
      'label variable declaration',
      'string namespace defaultLibrary,global',
      'format function defaultLibrary',
      'SemanticTotal variable global',
    ]);
  });
});
