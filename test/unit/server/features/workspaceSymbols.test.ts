import assert from 'node:assert/strict';
import type { SymbolInformation } from 'vscode-languageserver/node';
import { collectWorkspaceSymbols, fileSymbols, type SymbolSource } from '../../../../src/server/features/workspaceSymbols.ts';

const symbol = (name: string, uri: string): SymbolInformation => ({
  name,
  kind: 12,
  location: { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
});

describe('server/features/workspaceSymbols', () => {
  it('lists the flat outline of a file with positions and containers', () => {
    const symbols = fileSymbols('local M = {}\nfunction M.open()\nend\n', 'file:///w/a.lua');
    assert.deepEqual(
      symbols.map((s) => [s.name, s.containerName ?? '', s.location.uri, s.location.range.start.line]),
      [
        ['M', '', 'file:///w/a.lua', 0],
        ['M.open', '', 'file:///w/a.lua', 1],
      ],
    );
  });

  it('recognizes .menu files by their extension, in any letter case', () => {
    const symbols = fileSymbols('menu\n{\n\tname "MAIN"\n\tonOpen "x = 1"\n}\n`\nfunction ready() end\n`\n', 'file:///w/UI.MENU');
    assert.deepEqual(symbols.map((s) => s.name), ['MAIN', 'ready']);
  });

  it('returns the matching symbols of open documents and of indexed files that are not open', () => {
    const open: SymbolSource[] = [{ key: '/w/a.lua', symbols: () => [symbol('openVersion', 'file:///w/a.lua')] }];
    const indexed = [
      { uri: 'file:///w/a.lua', key: '/w/a.lua', value: [symbol('savedVersion', 'file:///w/a.lua')] },
      { uri: 'file:///w/b.lua', key: '/w/b.lua', value: [symbol('other', 'file:///w/b.lua'), symbol('version', 'file:///w/b.lua')] },
    ];
    const names = (query: string): string[] | undefined => collectWorkspaceSymbols(open, indexed, query, () => false)?.map((s) => s.name);
    assert.deepEqual(names(''), ['openVersion', 'other', 'version']);
    assert.deepEqual(names('ver'), ['openVersion', 'version']);
  });

  it('stops when cancelled', () => {
    let calls = 0;
    const result = collectWorkspaceSymbols([], [{ uri: 'file:///w/a.lua', key: '/w/a.lua', value: [] }], '', () => ++calls > 0);
    assert.equal(result, undefined);
  });
});
