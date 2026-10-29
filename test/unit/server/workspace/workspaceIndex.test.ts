import assert from 'node:assert/strict';
import { posix, win32 } from 'node:path';
import { isIndexedFileName, WorkspaceIndex, type DirectoryEntry, type WorkspaceFileSystem } from '../../../../src/server/workspace/workspaceIndex.ts';

/** An in-memory file system keyed by full path; `links` marks symbolic links. */
class MemoryFileSystem implements WorkspaceFileSystem {
  readonly files = new Map<string, string>();
  readonly links = new Set<string>();
  readonly reads: string[] = [];
  /** Paths whose read never completes, to hold the index's queue. */
  readonly hanging = new Set<string>();
  private readonly sep: string;

  constructor(sep = '/') {
    this.sep = sep;
  }

  add(path: string, text = ''): this {
    this.files.set(path, text);
    return this;
  }

  readDirectory(path: string): Promise<DirectoryEntry[]> {
    const prefix = path.endsWith(this.sep) ? path : `${path}${this.sep}`;
    const entries = new Map<string, DirectoryEntry['kind']>();
    for (const file of [...this.files.keys(), ...this.links]) {
      if (!file.startsWith(prefix)) continue;
      const [name, ...rest] = file.slice(prefix.length).split(this.sep);
      if (!name) continue;
      const kind = this.links.has(prefix + name) ? 'symlink' : rest.length > 0 ? 'directory' : 'file';
      entries.set(name, kind);
    }
    if (entries.size === 0 && ![...this.files.keys()].some((file) => file.startsWith(prefix))) {
      return Promise.reject(new Error(`ENOENT: ${path}`));
    }
    return Promise.resolve([...entries].map(([name, kind]) => ({ name, kind })));
  }

  readFile(path: string): Promise<Uint8Array> {
    this.reads.push(path);
    if (this.hanging.has(path)) return new Promise(() => undefined);
    const text = this.files.get(path);
    return text === undefined
      ? Promise.reject(Object.assign(new Error(`ENOENT: no such file, open '${path}'`), { code: 'ENOENT' }))
      : Promise.resolve(new TextEncoder().encode(text));
  }
}

function setup(fs: MemoryFileSystem, excludes: Record<string, unknown> = {}) {
  const log: string[] = [];
  let yields = 0;
  const index = new WorkspaceIndex<string>({
    fs,
    path: posix,
    toPath: (uri) => decodeURIComponent(new URL(uri).pathname),
    analyze: (text) => text,
    filesExclude: (folder) => Promise.resolve(excludes[folder]),
    yieldToEventLoop: () => {
      yields++;
      return Promise.resolve();
    },
    log: (message) => log.push(message),
  });
  const indexed = (): string[] => [...index.entries()].map((e) => `${e.uri}=${e.value}`).sort();
  return { index, log, indexed, yields: () => yields };
}

describe('server/workspace/workspaceIndex', () => {
  it('recognizes Lua and .menu files in any letter case', () => {
    assert.deepEqual(['a.lua', 'UI.MENU', 'b.Lua', 'c.luac', 'menu', 'x.txt'].filter(isIndexedFileName), ['a.lua', 'UI.MENU', 'b.Lua']);
  });

  it('indexes every Lua and .menu file of every folder, one file per yield', async () => {
    const fs = new MemoryFileSystem().add('/w/a.lua', 'A').add('/w/sub/UI.MENU', 'M').add('/w/notes.txt', 'N').add('/v/b.lua', 'B');
    const { index, indexed, yields, log } = setup(fs);
    index.setFolders(['file:///w', 'file:///v/']);
    await index.ready();
    assert.deepEqual(indexed(), ['file:///v/b.lua=B', 'file:///w/a.lua=A', 'file:///w/sub/UI.MENU=M']);
    assert.equal(yields(), 3);
    assert.match(log.at(-1) ?? '', /^Indexed 3 Lua and \.menu files in \d+ ms\.$/);
  });

  it('percent-encodes path segments in the URIs it builds', async () => {
    const { index, indexed } = setup(new MemoryFileSystem().add('/w/my mod/a#1.lua', 'x'));
    index.setFolders(['file:///w']);
    await index.ready();
    assert.deepEqual(indexed(), ['file:///w/my%20mod/a%231.lua=x']);
  });

  it('skips files.exclude matches, including whole folders, relative to each folder', async () => {
    const fs = new MemoryFileSystem().add('/w/keep.lua').add('/w/out/gen.lua').add('/w/a.lua').add('/w/a.menu').add('/w/x/.git/h.lua');
    const { index, indexed } = setup(fs, { 'file:///w': { 'out': true, '**/.git': true, '*.lua': { when: '$(basename).menu' } } });
    index.setFolders(['file:///w']);
    await index.ready();
    assert.deepEqual(indexed(), ['file:///w/a.menu=', 'file:///w/keep.lua=']);
    assert.ok(!fs.reads.some((path) => path.startsWith('/w/out/')), 'an excluded folder is not read');
  });

  it('reads symbolic links to files but never descends into linked folders', async () => {
    const fs = new MemoryFileSystem().add('/w/real/a.lua', 'A').add('/w/linked.lua', 'L');
    fs.links.add('/w/linked.lua');
    fs.links.add('/w/loop');
    const { index, indexed } = setup(fs);
    index.setFolders(['file:///w']);
    await index.ready();
    assert.deepEqual(indexed(), ['file:///w/linked.lua=L', 'file:///w/real/a.lua=A']);
  });

  it('logs and skips what it cannot read, but not files that are gone', async () => {
    const fs = new MemoryFileSystem().add('/w/a.lua', 'A').add('/w/locked.lua');
    fs.readFile = (path) => (path === '/w/locked.lua' ? Promise.reject(new Error('EACCES: permission denied')) : MemoryFileSystem.prototype.readFile.call(fs, path));
    fs.links.add('/w/broken.lua');
    const { index, indexed, log } = setup(fs);
    index.setFolders(['file:///w', 'file:///missing']);
    await index.ready();
    assert.deepEqual(indexed(), ['file:///w/a.lua=A']);
    assert.ok(log.some((line) => line === 'Cannot read /w/locked.lua: EACCES: permission denied'));
    assert.ok(!log.some((line) => line.includes('broken.lua')), 'a dangling link is a file that is gone, not an error');
    assert.ok(log.some((line) => line.startsWith('Cannot list /missing')));
  });

  it('does not log when the file of a closed document no longer exists', async () => {
    const fs = new MemoryFileSystem().add('/w/a.lua', 'A').add('/w/notes.txt');
    const { index, indexed, log } = setup(fs);
    index.setFolders(['file:///w']);
    await index.ready();
    const lines = log.length;
    fs.files.delete('/w/a.lua');
    index.fileChanged('file:///w/a.lua');
    await index.ready();
    assert.deepEqual(indexed(), []);
    assert.equal(log.length, lines);
  });

  it('answers ready() for the work queued before the call, even while more keeps arriving', async () => {
    const fs = new MemoryFileSystem().add('/w/a.lua', 'A').add('/w/slow.lua', 'S');
    const { index, indexed } = setup(fs);
    index.setFolders(['file:///w']);
    await index.ready();
    fs.add('/w/a.lua', 'A2');
    index.fileChanged('file:///w/a.lua');
    const ready = index.ready();
    // Work queued after the call never finishes; the call must not wait for it.
    fs.hanging.add('/w/slow.lua');
    index.fileChanged('file:///w/slow.lua');
    await ready;
    // slow.lua is being read again: its previous entry stays meanwhile.
    assert.deepEqual(indexed(), ['file:///w/a.lua=A2', 'file:///w/slow.lua=S']);
  });

  it('waits in ready() for the rescan a files.exclude change starts', async () => {
    const fs = new MemoryFileSystem().add('/w/a.lua', 'A').add('/w/b.lua', 'B');
    const excludes: Record<string, unknown> = {};
    const { index, indexed } = setup(fs, excludes);
    index.setFolders(['file:///w']);
    await index.ready();
    excludes['file:///w'] = { 'b.lua': true };
    index.settingsChanged();
    await index.ready();
    assert.deepEqual(indexed(), ['file:///w/a.lua=A']);
  });

  it('handles Windows paths: separators, drive letters and URIs', async () => {
    const fs = new MemoryFileSystem('\\').add('c:\\Mods\\My Mod\\a.lua', 'A').add('c:\\Mods\\out\\b.lua', 'B');
    const log: string[] = [];
    const index = new WorkspaceIndex<string>({
      fs,
      path: win32,
      // fileURLToPath as on Windows, for the two URI spellings clients use.
      toPath: (uri) => decodeURIComponent(new URL(uri).pathname).replace(/^\/([A-Za-z]):/, '$1:').replaceAll('/', '\\'),
      analyze: (text) => text,
      filesExclude: () => Promise.resolve({ out: true }),
      yieldToEventLoop: () => Promise.resolve(),
      log: (message) => log.push(message),
    });
    index.setFolders(['file:///c%3A/Mods']);
    await index.ready();
    assert.deepEqual([...index.entries()].map((e) => [e.uri, e.key, e.value]), [
      ['file:///c%3A/Mods/My%20Mod/a.lua', 'c:\\Mods\\My Mod\\a.lua', 'A'],
    ]);
    // An open document spelled with an upper-case drive letter is the same file.
    assert.equal(index.pathKey('file:///C:/Mods/My%20Mod/a.lua'), 'c:\\Mods\\My Mod\\a.lua');
    index.fileDeleted('file:///C:/Mods/My%20Mod');
    await index.ready();
    assert.deepEqual([...index.entries()], []);
  });

  it('scans only file: folders and says so for the others', async () => {
    const { index, log } = setup(new MemoryFileSystem());
    index.setFolders(['vscode-vfs://github/x/y']);
    await index.ready();
    assert.ok(log.some((line) => line.includes('vscode-vfs://github/x/y is not on the local file system')));
  });

  it('reindexes changed files and drops deleted files and folders', async () => {
    const fs = new MemoryFileSystem().add('/w/a.lua', 'old').add('/w/d/b.lua', 'B').add('/w/d/c.lua', 'C');
    const { index, indexed } = setup(fs);
    index.setFolders(['file:///w']);
    fs.add('/w/a.lua', 'new').add('/w/n.lua', 'N');
    index.fileChanged('file:///w/a.lua');
    index.fileChanged('file:///w/n.lua');
    index.fileDeleted('file:///w/d');
    await index.ready();
    assert.deepEqual(indexed(), ['file:///w/a.lua=new', 'file:///w/n.lua=N']);
  });

  it('indexes the files of a created folder, except excluded ones', async () => {
    const fs = new MemoryFileSystem().add('/w/a.lua', 'A');
    const { index, indexed } = setup(fs, { 'file:///w': { '**/skip.lua': true } });
    index.setFolders(['file:///w']);
    fs.add('/w/moved/sub/b.lua', 'B').add('/w/moved/skip.lua', 'S').add('/w/moved/readme.txt');
    index.fileChanged('file:///w/moved');
    await index.ready();
    assert.deepEqual(indexed(), ['file:///w/a.lua=A', 'file:///w/moved/sub/b.lua=B']);
  });

  it('rescans when files.exclude changes, and only then', async () => {
    const fs = new MemoryFileSystem().add('/w/a.lua', 'A').add('/w/b.lua', 'B');
    const excludes: Record<string, unknown> = { 'file:///w': { 'x.lua': true } };
    const { index, indexed } = setup(fs, excludes);
    index.setFolders(['file:///w']);
    await index.ready();
    const reads = fs.reads.length;
    index.settingsChanged();
    await index.ready();
    assert.equal(fs.reads.length, reads, 'an unrelated settings change rescans nothing');
    excludes['file:///w'] = { 'b.lua': true };
    index.settingsChanged();
    await index.ready();
    assert.deepEqual(indexed(), ['file:///w/a.lua=A']);
  });

  it('ignores changes outside the folders, to other file types, and to excluded files', async () => {
    const fs = new MemoryFileSystem().add('/w/out/x.lua', 'X').add('/w/t.txt', 'T').add('/elsewhere/e.lua', 'E');
    const { index, indexed } = setup(fs, { 'file:///w': { out: true } });
    index.setFolders(['file:///w']);
    index.fileChanged('file:///w/out/x.lua');
    index.fileChanged('file:///w/t.txt');
    index.fileChanged('file:///elsewhere/e.lua');
    index.fileChanged('untitled:Untitled-1');
    await index.ready();
    assert.deepEqual(indexed(), []);
  });

  it('rescans with the new files.exclude value', async () => {
    const fs = new MemoryFileSystem().add('/w/a.lua', 'A').add('/w/b.lua', 'B');
    const excludes: Record<string, unknown> = {};
    const { index, indexed } = setup(fs, excludes);
    index.setFolders(['file:///w']);
    await index.ready();
    excludes['file:///w'] = { 'b.lua': true };
    index.rescan();
    await index.ready();
    assert.deepEqual(indexed(), ['file:///w/a.lua=A']);
  });

  it('abandons a scan that a newer one supersedes', async () => {
    const fs = new MemoryFileSystem().add('/w/a.lua', 'A').add('/v/b.lua', 'B');
    const { index, indexed } = setup(fs);
    index.setFolders(['file:///w']);
    index.setFolders(['file:///v']);
    await index.ready();
    assert.deepEqual(indexed(), ['file:///v/b.lua=B']);
    assert.ok(!fs.reads.includes('/w/a.lua'));
  });

  it('keys files by native path, with the Windows drive letter in lower case', () => {
    const { index } = setup(new MemoryFileSystem());
    const windows = new WorkspaceIndex<string>({
      fs: new MemoryFileSystem(),
      path: posix,
      toPath: () => 'C:\\mods\\a.lua',
      analyze: (text) => text,
      filesExclude: () => Promise.resolve(undefined),
      yieldToEventLoop: () => Promise.resolve(),
      log: () => undefined,
    });
    assert.equal(windows.pathKey('file:///C:/mods/a.lua'), 'c:\\mods\\a.lua');
    assert.equal(index.pathKey('untitled:Untitled-1'), undefined);
  });
});
