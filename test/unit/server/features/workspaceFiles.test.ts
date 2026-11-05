import assert from 'node:assert/strict';
import { analyzeFile, type GlobalLocation } from '../../../../src/server/features/workspaceFiles.ts';

/** `line:character` of each location, with `=` for assignments. */
const where = (locations: readonly GlobalLocation[] | undefined): string[] | undefined =>
  locations?.map(({ range, isWrite }) => `${String(range.start.line)}:${String(range.start.character)}${isWrite ? '=' : ''}`);

describe('server/features/workspaceFiles', () => {
  describe('analyzeFile', () => {
    it('lists the flat outline of a file with positions and containers', () => {
      const { symbols } = analyzeFile('local M = {}\nfunction M.open()\nend\n', 'file:///w/a.lua');
      assert.deepEqual(
        symbols.map((s) => [s.name, s.containerName ?? '', s.location.uri, s.location.range.start.line]),
        [
          ['M', '', 'file:///w/a.lua', 0],
          ['M.open', '', 'file:///w/a.lua', 1],
        ],
      );
    });

    it('recognizes .menu files by their extension, in any letter case', () => {
      const { symbols } = analyzeFile('menu\n{\n\tname "MAIN"\n\tonOpen "x = 1"\n}\n`\nfunction ready() end\n`\n', 'file:///w/UI.MENU');
      assert.deepEqual(symbols.map((s) => s.name), ['MAIN', 'ready']);
    });

    it('lists where a Lua file names each global, with its assignments', () => {
      const { globals } = analyzeFile('local x = 1\nTotal = x\nfunction Add(n)\n\tTotal = Total + n\nend\nprint(Total)\n', 'file:///w/a.lua');
      assert.deepEqual([...globals.keys()].sort(), ['Add', 'Total', 'print']);
      assert.deepEqual(where(globals.get('Total')), ['1:0=', '3:1=', '3:9', '5:6']);
      assert.deepEqual(where(globals.get('Add')), ['2:9=']);
      assert.equal(globals.get('x'), undefined);
    });

    it('collects the globals of every Lua chunk of a .menu file, in document order', () => {
      const text = '`\nshown = 0\n`\nmenu\n{\n\tname "MAIN"\n\tonOpen "shown = shown + 1"\n\tlabel { enabled "shown > 0" }\n}\n';
      assert.deepEqual(where(analyzeFile(text, 'file:///w/UI.menu').globals.get('shown')), ['1:0=', '6:9=', '6:17', '7:18']);
    });

    it('leaves out _ENV and the names resolved through a local _ENV', () => {
      const { globals } = analyzeFile('local _ENV = { y = 1 }\nz = y\n', 'file:///w/env.lua');
      assert.deepEqual([...globals.keys()], []);
      const free = analyzeFile('_ENV.a = 1\nb = 2\n', 'file:///w/free.lua').globals;
      assert.deepEqual([...free.keys()], ['b']);
    });
  });
});
