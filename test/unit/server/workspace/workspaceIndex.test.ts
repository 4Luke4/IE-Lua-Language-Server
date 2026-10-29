import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { isIndexedFileName, WorkspaceIndex, type DirectoryEntry, type WorkspaceFileSystem } from '../../../../src/server/workspace/workspaceIndex.ts';

/** An in-memory file system: paths ending in `/` are directories, `@` marks a symbolic link. */
class MemoryFileSystem implements WorkspaceFileSystem {
  readonly files = new Map<string, string>();
  readonly links = new Set<string>();
  readonly reads: string[] = [];

  add(path: string, text = ''): this {
    this.files.set(path, text);
    return this;
  }

  readDirectory(path: string): Promise<DirectoryEntry[]> {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const entries = new Map<string, DirectoryEntry['kind']>();
    for (const file of [...this.files.keys(), ...this.links]) {
      if (!file.startsWith(prefix)) continue;
      const [name, ...rest] = file.slice(prefix.length).split('/');
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
    const text = this.files.get(path);
    return text === undefined ? Promise.reject(new Error(`ENOENT: ${path}`)) : Promise.resolve(new TextEncoder().encode(text));
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

  it('logs and skips what it cannot read', async () => {
    const fs = new MemoryFileSystem().add('/w/a.lua', 'A');
    fs.links.add('/w/broken.lua');
    const { index, indexed, log } = setup(fs);
    index.setFolders(['file:///w', 'file:///missing']);
    await index.ready();
    assert.deepEqual(indexed(), ['file:///w/a.lua=A']);
    assert.ok(log.some((line) => line.startsWith('Cannot read /w/broken.lua')));
    assert.ok(log.some((line) => line.startsWith('Cannot list /missing')));
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
