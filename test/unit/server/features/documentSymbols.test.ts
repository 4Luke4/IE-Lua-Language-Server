import assert from 'node:assert/strict';
import { SymbolKind, type DocumentSymbol, type SymbolInformation } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { toLspSymbols } from '../../../../src/server/features/documentSymbols.ts';
import { parseDocument } from '../../../../src/server/syntax/document.ts';
import { documentSymbols } from '../../../../src/server/syntax/symbols.ts';

const text = 'local config = { size = 1 }\nfunction M:run(x)\n  local function step() end\nend\n';
const document = TextDocument.create('file:///a.lua', 'lua', 1, text);
const symbols = documentSymbols(parseDocument(text, 'lua'), text.length);
const convert = (hierarchical: boolean) =>
  toLspSymbols(symbols, { hierarchical, uri: document.uri, positionAt: (offset) => document.positionAt(offset) });

describe('server/features/documentSymbols toLspSymbols', () => {
  it('returns nested DocumentSymbols with kinds, details and ranges for hierarchical clients', () => {
    const [config, run] = convert(true) as DocumentSymbol[];
    assert.ok(config && run);
    assert.equal(config.kind, SymbolKind.Variable);
    assert.deepEqual(config.children?.map((c) => [c.name, c.kind]), [['size', SymbolKind.Field]]);
    assert.equal(run.name, 'M:run');
    assert.equal(run.kind, SymbolKind.Method);
    assert.equal(run.detail, '(x)');
    assert.deepEqual(run.range, { start: { line: 1, character: 0 }, end: { line: 3, character: 3 } });
    assert.deepEqual(run.selectionRange, { start: { line: 1, character: 9 }, end: { line: 1, character: 14 } });
    assert.deepEqual(run.children?.map((c) => [c.name, c.kind]), [['step', SymbolKind.Function]]);
  });

  it('returns a flat list in document order with container names for other clients', () => {
    const flat = convert(false) as SymbolInformation[];
    assert.deepEqual(
      flat.map((s) => [s.name, s.containerName, s.location.uri, s.location.range.start.line]),
      [
        ['config', undefined, 'file:///a.lua', 0],
        ['size', 'config', 'file:///a.lua', 0],
        ['M:run', undefined, 'file:///a.lua', 1],
        ['step', 'M:run', 'file:///a.lua', 2],
      ],
    );
    assert.ok(flat.every((s) => !('children' in s)));
  });
});
