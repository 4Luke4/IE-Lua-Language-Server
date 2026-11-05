import assert from 'node:assert/strict';
import { CancellationTokenSource, LSPErrorCodes, ResponseError, type Location } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParsedDocumentCache } from '../../../../src/server/documentCache.ts';
import {
  analyzeFile,
  collectGlobalLocations,
  otherFileLocations,
  type CrossFileDeps,
  type IndexedFileFacts,
} from '../../../../src/server/features/workspaceFiles.ts';
import { globalRanges, type FileGlobals } from '../../../../src/server/syntax/fileGlobals.ts';
import type { IndexedFile } from '../../../../src/server/workspace/workspaceIndex.ts';

/** `line:character` of each use of `name`, with `=` for assignments; `undefined` when the file has none. */
function where(globals: FileGlobals, name: string): string[] | undefined {
  if (!globals.slots.has(name)) return undefined;
  const at = ({ start }: { start: { line: number; character: number } }): string => `${String(start.line)}:${String(start.character)}`;
  const writes = new Set(globalRanges(globals, name, (isWrite) => isWrite).map(at));
  return globalRanges(globals, name, () => true).map((range) => `${at(range)}${writes.has(at(range)) ? '=' : ''}`);
}

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
      assert.deepEqual([...globals.slots.keys()].sort(), ['Add', 'Total', 'print']);
      assert.deepEqual(where(globals, 'Total'), ['1:0=', '3:1=', '3:9', '5:6']);
      assert.deepEqual(where(globals, 'Add'), ['2:9=']);
      assert.equal(where(globals, 'x'), undefined);
    });

    it('collects the globals of every Lua chunk of a .menu file, in document order', () => {
      const text = '`\nshown = 0\n`\nmenu\n{\n\tname "MAIN"\n\tonOpen "shown = shown + 1"\n\tlabel { enabled "shown > 0" }\n}\n';
      assert.deepEqual(where(analyzeFile(text, 'file:///w/UI.menu').globals, 'shown'), ['1:0=', '6:9=', '6:17', '7:18']);
    });

    it('leaves out _ENV and the names resolved through a local _ENV', () => {
      const { globals } = analyzeFile('local _ENV = { y = 1 }\nz = y\n', 'file:///w/env.lua');
      assert.deepEqual([...globals.slots.keys()], []);
      const free = analyzeFile('_ENV.a = 1\nb = 2\n', 'file:///w/free.lua').globals;
      assert.deepEqual([...free.slots.keys()], ['b']);
    });
  });

  describe('collectGlobalLocations', () => {
    /** An indexed file analyzed from `text`, keyed by its path. */
    const indexed = (path: string, text: string): IndexedFile<IndexedFileFacts> => ({ uri: `file://${path}`, key: path, value: analyzeFile(text, `file://${path}`) });
    const all = (): boolean => true;
    const writes = (isWrite: boolean): boolean => isWrite;
    const show = (locations: Location[] | undefined): string[] | undefined =>
      locations?.map(({ uri, range }) => `${uri.slice('file:///w/'.length)} ${String(range.start.line)}:${String(range.start.character)}`);

    it('lists the uses in other files, in URI order, skipping the current document', () => {
      const files = [indexed('/w/c.lua', 'print(G)\n'), indexed('/w/a.lua', 'G = 1\nG = G + 1\n'), indexed('/w/self.lua', 'G = 2\n'), indexed('/w/b.lua', 'local G = 0\n')];
      assert.deepEqual(show(collectGlobalLocations('G', all, '/w/self.lua', [], files, () => false)), ['a.lua 0:0', 'a.lua 1:0', 'a.lua 1:4', 'c.lua 0:6']);
      assert.deepEqual(show(collectGlobalLocations('G', writes, '/w/self.lua', [], files, () => false)), ['a.lua 0:0', 'a.lua 1:0']);
      assert.deepEqual(collectGlobalLocations('Missing', all, '/w/self.lua', [], files, () => false), []);
    });

    it('takes an open document over its saved version, once', () => {
      const saved = indexed('/w/a.lua', 'G = 1\n');
      const reads: string[] = [];
      const open = [
        { uri: 'file:///w/a.lua', key: '/w/a.lua', globals: () => (reads.push('a'), analyzeFile('\n\nG = 1\n', 'file:///w/a.lua').globals) },
        { uri: 'untitled:Untitled-1', key: 'untitled:Untitled-1', globals: () => (reads.push('untitled'), analyzeFile('x = G\n', 'untitled:Untitled-1').globals) },
        { uri: 'file:///w/a.lua', key: '/w/a.lua', globals: () => (reads.push('again'), analyzeFile('', 'file:///w/a.lua').globals) },
      ];
      const found = collectGlobalLocations('G', all, '/w/self.lua', open, [saved], () => false);
      assert.deepEqual(found?.map(({ uri, range }) => `${uri} ${String(range.start.line)}`), ['file:///w/a.lua 2', 'untitled:Untitled-1 0']);
      assert.deepEqual(reads, ['a', 'untitled']);
    });

    it('stops when cancelled', () => {
      let calls = 0;
      assert.equal(collectGlobalLocations('G', all, '/w/self.lua', [], [indexed('/w/a.lua', 'G = 1')], () => ++calls > 0), undefined);
    });
  });

  describe('otherFileLocations', () => {
    /** Open documents as `TextDocuments` exposes them. */
    const openDocuments = (...open: TextDocument[]) => ({
      get: (uri: string) => open.find((document) => document.uri === uri),
      all: () => open,
    });
    const deps = (entries: IndexedFile<IndexedFileFacts>[], ready: Promise<void> = Promise.resolve()): CrossFileDeps => ({
      cache: new ParsedDocumentCache(),
      index: { ready: () => ready, pathKey: (uri) => (uri.startsWith('file://') ? uri.slice('file://'.length) : undefined), entries: () => entries.values() },
    });
    const saved: IndexedFile<IndexedFileFacts> = { uri: 'file:///w/b.lua', key: '/w/b.lua', value: analyzeFile('G = 1\n', 'file:///w/b.lua') };

    it('finds the uses in the open documents and the indexed files', async () => {
      const current = TextDocument.create('file:///w/a.lua', 'lua', 1, 'print(G)\n');
      const other = TextDocument.create('untitled:Untitled-1', 'lua', 1, 'G = 2\n');
      const found = await otherFileLocations(openDocuments(current, other), current, 'G', () => true, deps([saved]), new CancellationTokenSource().token);
      assert.ok(Array.isArray(found));
      assert.deepEqual(found.map(({ uri }) => uri), ['file:///w/b.lua', 'untitled:Untitled-1']);
    });

    it('waits for the files queued for indexing', async () => {
      const current = TextDocument.create('file:///w/a.lua', 'lua', 1, 'print(G)\n');
      const entries: IndexedFile<IndexedFileFacts>[] = [];
      let finish = (): void => undefined;
      const ready = new Promise<void>((resolve) => {
        finish = () => {
          entries.push(saved);
          resolve();
        };
      });
      let settled = false;
      const pending = otherFileLocations(openDocuments(current), current, 'G', () => true, deps(entries, ready), new CancellationTokenSource().token);
      void pending.then(() => (settled = true));
      // Every pending callback runs before `setImmediate` fires: the request is still waiting.
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(settled, false);
      finish();
      const found = await pending;
      assert.ok(Array.isArray(found));
      assert.deepEqual(found.map(({ uri }) => uri), ['file:///w/b.lua']);
    });

    it('answers null when cancelled while waiting', async () => {
      const current = TextDocument.create('file:///w/a.lua', 'lua', 1, 'print(G)\n');
      const source = new CancellationTokenSource();
      const pending = otherFileLocations(openDocuments(current), current, 'G', () => true, deps([saved], new Promise(() => undefined)), source.token);
      source.cancel();
      assert.equal(await pending, null);
    });

    it('answers ContentModified when the document changed while waiting', async () => {
      const current = TextDocument.create('file:///w/a.lua', 'lua', 1, 'print(G)\n');
      const newer = TextDocument.create('file:///w/a.lua', 'lua', 2, 'print(G, G)\n');
      const found = await otherFileLocations(openDocuments(newer), current, 'G', () => true, deps([saved]), new CancellationTokenSource().token);
      assert.ok(found instanceof ResponseError);
      assert.equal(found.code, LSPErrorCodes.ContentModified);
    });
  });
});
