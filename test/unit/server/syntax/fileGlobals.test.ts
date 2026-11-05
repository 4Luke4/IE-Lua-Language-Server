import assert from 'node:assert/strict';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseDocument } from '../../../../src/server/syntax/document.ts';
import { fileGlobals, globalRanges, lineStarts, positionAt } from '../../../../src/server/syntax/fileGlobals.ts';

describe('server/syntax/fileGlobals', () => {
  it('splits lines at \\n, \\r\\n and a lone \\r', () => {
    assert.deepEqual([...lineStarts('a\nb\r\nc\rd')], [0, 2, 5, 7]);
    assert.deepEqual([...lineStarts('')], [0]);
    assert.deepEqual([...lineStarts('\n')], [0, 1]);
  });

  it('gives the positions TextDocument gives, for every offset', () => {
    const text = 'x = 1\r\n\tlocal ü = "€"\rG = x\n\n-- 𝄞 end\n';
    const document = TextDocument.create('file:///w/a.lua', 'lua', 1, text);
    const starts = lineStarts(text);
    for (let offset = 0; offset <= text.length; offset++) {
      // Inside \r\n TextDocument moves the offset before the line break; no identifier is ever there.
      if (text[offset - 1] === '\r' && text[offset] === '\n') continue;
      assert.deepEqual(positionAt(starts, offset), document.positionAt(offset), `offset ${String(offset)}`);
    }
  });

  it('keeps the uses of each shared global and returns their ranges, filtered by assignment', () => {
    const text = 'G = 1\nprint(G)\nlocal l = G\ndo local _ENV = {} G = 2 end\n';
    const globals = fileGlobals(parseDocument(text, 'lua'));
    assert.deepEqual([...globals.slots.keys()].sort(), ['G', 'print']);
    const lines = (keep: (isWrite: boolean) => boolean): string[] =>
      globalRanges(globals, 'G', keep).map(({ start, end }) => `${String(start.line)}:${String(start.character)}-${String(end.character)}`);
    assert.deepEqual(lines(() => true), ['0:0-1', '1:6-7', '2:10-11']);
    assert.deepEqual(lines((isWrite) => isWrite), ['0:0-1']);
    assert.deepEqual(lines((isWrite) => !isWrite), ['1:6-7', '2:10-11']);
    assert.deepEqual(globalRanges(globals, 'missing', () => true), []);
  });
});
