// Index of the Lua and .menu files in the workspace folders, for workspace-wide
// features. No LSP connection: the file system, the per-file analysis, the
// `files.exclude` lookup and the event-loop yield are injected, so the index can be
// unit-tested with an in-memory file system.

import { fileURLToPath } from 'node:url';
import { filesExcludeFilter, type ExcludeFilter } from './filesExclude.ts';

/** An entry of a directory listing. Symbolic links are reported as such, not followed. */
export interface DirectoryEntry {
  readonly name: string;
  readonly kind: 'file' | 'directory' | 'symlink' | 'other';
}

/** The file system, by native path. */
export interface WorkspaceFileSystem {
  readDirectory(path: string): Promise<DirectoryEntry[]>;
  readFile(path: string): Promise<Uint8Array>;
}

export interface WorkspaceIndexDeps<T> {
  readonly fs: WorkspaceFileSystem;
  /** Native path functions (`node:path` in the server; `posix` in tests). */
  readonly path: {
    readonly sep: string;
    join(...parts: string[]): string;
    dirname(path: string): string;
    basename(path: string): string;
    relative(from: string, to: string): string;
  };
  /** `fileURLToPath` for `file:` URIs (injectable for tests of other platforms). */
  readonly toPath?: (uri: string) => string;
  /** What the index keeps for one file, from its text. */
  analyze(text: string, uri: string): T;
  /** The `files.exclude` value for a workspace folder (`undefined` when the client has none). */
  filesExclude(folderUri: string): Promise<unknown>;
  /** Lets other events run between files, so a large workspace never blocks the server. */
  yieldToEventLoop(): Promise<void>;
  log(message: string): void;
}

export interface IndexedFile<T> {
  readonly uri: string;
  /** The normalized native path (see `pathKey`). */
  readonly key: string;
  readonly value: T;
}

/** Lua files and .menu files, in any letter case, as `documentKind` recognizes them. */
export function isIndexedFileName(name: string): boolean {
  return /\.(?:lua|menu)$/i.test(name);
}

interface Folder {
  readonly uri: string;
  readonly path: string;
  readonly key: string;
  excluded: ExcludeFilter;
  /** The `files.exclude` value `excluded` was built from, as JSON. */
  excludeJson: string | undefined;
}

const decoder = new TextDecoder('utf-8');

/**
 * The index. Scans happen in the background, one file per macrotask; `ready()`
 * resolves once the work queued so far is done. Never rejects: failures are
 * logged and the file is left out.
 */
export class WorkspaceIndex<T> {
  private readonly deps: WorkspaceIndexDeps<T>;
  private readonly toPath: (uri: string) => string;
  private folders: Folder[] = [];
  private readonly files = new Map<string, IndexedFile<T>>();
  /** Incremented by every full rescan; a scan of an older generation stops. */
  private generation = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(deps: WorkspaceIndexDeps<T>) {
    this.deps = deps;
    this.toPath = deps.toPath ?? ((uri) => fileURLToPath(uri));
  }

  /** The key of a `file:` URI: its native path, with a Windows drive letter in lower case. */
  pathKey(uri: string): string | undefined {
    if (!uri.startsWith('file:')) return undefined;
    try {
      return normalizeKey(this.toPath(uri));
    } catch {
      return undefined;
    }
  }

  /** Replaces the workspace folders and rescans them. Only `file:` folders are scanned. */
  setFolders(folderUris: readonly string[]): void {
    const folders: Folder[] = [];
    for (const uri of folderUris) {
      const key = this.pathKey(uri);
      if (key === undefined) {
        this.deps.log(`Workspace folder ${uri} is not on the local file system; only its open documents are indexed.`);
        continue;
      }
      folders.push({ uri: uri.replace(/\/+$/, ''), path: this.toPath(uri), key, excluded: () => false, excludeJson: undefined });
    }
    this.folders = folders;
    this.rescan();
  }

  /** Rescans every folder, re-reading `files.exclude` (call when it changes). */
  rescan(): void {
    const generation = ++this.generation;
    this.enqueue(async () => {
      const started = Date.now();
      const found: { folder: Folder; path: string }[] = [];
      for (const folder of this.folders) {
        const value = await this.deps.filesExclude(folder.uri);
        folder.excluded = filesExcludeFilter(value);
        folder.excludeJson = JSON.stringify(value ?? null);
        await this.walk(folder, folder.path, found, generation);
        if (generation !== this.generation) return;
      }
      this.files.clear();
      for (const { folder, path } of found) {
        await this.deps.yieldToEventLoop();
        if (generation !== this.generation) return;
        await this.indexFile(folder, path);
      }
      this.deps.log(`Indexed ${this.files.size} Lua and .menu files in ${Date.now() - started} ms.`);
    });
  }

  /**
   * Settings changed: re-reads `files.exclude` and rescans if it changed for any
   * folder. Clients notify every settings change, so this avoids needless rescans.
   */
  settingsChanged(): void {
    this.enqueue(async () => {
      let changed = false;
      for (const folder of this.folders) {
        if (JSON.stringify((await this.deps.filesExclude(folder.uri)) ?? null) !== folder.excludeJson) changed = true;
      }
      if (changed) this.rescan();
    });
  }

  /**
   * A file was created or changed on disk, or closed in the editor: index it
   * again. A created folder (for example one moved into the workspace) has its
   * files indexed.
   */
  fileChanged(uri: string): void {
    this.enqueue(async () => {
      const key = this.pathKey(uri);
      const folder = key === undefined ? undefined : this.folderOf(key);
      if (key === undefined || !folder) return;
      const path = this.toPath(uri);
      if (isIndexedFileName(this.deps.path.basename(path))) {
        this.files.delete(key);
        if (!(await this.isExcluded(folder, path))) await this.indexFile(folder, path);
        return;
      }
      if (!(await this.isDirectory(path)) || (await this.isExcluded(folder, path))) return;
      const generation = this.generation;
      const found: { folder: Folder; path: string }[] = [];
      await this.walk(folder, path, found, generation);
      for (const file of found) {
        await this.deps.yieldToEventLoop();
        if (generation !== this.generation) return;
        await this.indexFile(file.folder, file.path);
      }
    });
  }

  /** A file or folder was deleted: drop it and everything under it. */
  fileDeleted(uri: string): void {
    this.enqueue(() => {
      const key = this.pathKey(uri);
      if (key === undefined) return Promise.resolve();
      const prefix = key.endsWith(this.deps.path.sep) ? key : key + this.deps.path.sep;
      for (const indexed of [...this.files.keys()]) {
        if (indexed === key || indexed.startsWith(prefix)) this.files.delete(indexed);
      }
      return Promise.resolve();
    });
  }

  /** Resolves when the work queued so far is done, including the work it queues itself. */
  async ready(): Promise<void> {
    let tail: Promise<void>;
    do {
      tail = this.tail;
      await tail;
    } while (tail !== this.tail);
  }

  /** The indexed files, in no particular order. */
  entries(): IterableIterator<IndexedFile<T>> {
    return this.files.values();
  }

  private enqueue(work: () => Promise<void>): void {
    this.tail = this.tail.then(work).catch((error: unknown) => {
      this.deps.log(`Workspace indexing failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    });
  }

  /** The innermost workspace folder containing `key`. */
  private folderOf(key: string): Folder | undefined {
    let best: Folder | undefined;
    for (const folder of this.folders) {
      const prefix = folder.key.endsWith(this.deps.path.sep) ? folder.key : folder.key + this.deps.path.sep;
      if (key.startsWith(prefix) && (!best || folder.key.length > best.key.length)) best = folder;
    }
    return best;
  }

  private relative(folder: Folder, path: string): string {
    return this.deps.path.relative(folder.path, path).split(this.deps.path.sep).join('/');
  }

  private async listing(directory: string): Promise<DirectoryEntry[] | undefined> {
    try {
      return await this.deps.fs.readDirectory(directory);
    } catch (error) {
      this.deps.log(`Cannot list ${directory}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  /** Collects the files to index under `directory`, depth first, in listing order. */
  private async walk(folder: Folder, directory: string, found: { folder: Folder; path: string }[], generation: number): Promise<void> {
    const entries = await this.listing(directory);
    if (!entries || generation !== this.generation) return;
    const names = new Set(entries.map((entry) => entry.name));
    const hasSibling = (name: string): boolean => names.has(name);
    for (const entry of entries) {
      const path = this.deps.path.join(directory, entry.name);
      if (folder.excluded(this.relative(folder, path), hasSibling)) continue;
      if (entry.kind === 'directory') {
        await this.walk(folder, path, found, generation);
        if (generation !== this.generation) return;
      } else if ((entry.kind === 'file' || entry.kind === 'symlink') && isIndexedFileName(entry.name)) {
        // A symbolic link is read (which follows it) but never descended into, so links cannot loop.
        found.push({ folder, path });
      }
    }
  }

  private async isDirectory(path: string): Promise<boolean> {
    try {
      await this.deps.fs.readDirectory(path);
      return true;
    } catch {
      // Not a directory (or gone): nothing to index.
      return false;
    }
  }

  /** Whether `path` or one of its folders below the workspace folder is excluded. */
  private async isExcluded(folder: Folder, path: string): Promise<boolean> {
    let current = path;
    while (current !== folder.path && current.length > folder.path.length) {
      const parent = this.deps.path.dirname(current);
      const names = new Set((await this.listing(parent))?.map((entry) => entry.name));
      if (folder.excluded(this.relative(folder, current), (name) => names.has(name))) return true;
      current = parent;
    }
    return false;
  }

  private async indexFile(folder: Folder, path: string): Promise<void> {
    let bytes: Uint8Array;
    try {
      bytes = await this.deps.fs.readFile(path);
    } catch (error) {
      this.deps.log(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const relative = this.relative(folder, path);
    const uri = `${folder.uri}/${relative.split('/').map(encodeURIComponent).join('/')}`;
    // UTF-8, with a byte order mark removed and invalid bytes replaced, as VS Code opens files by default.
    const value = this.deps.analyze(decoder.decode(bytes), uri);
    this.files.set(normalizeKey(path), { uri, key: normalizeKey(path), value });
  }
}

function normalizeKey(path: string): string {
  return path.replace(/^([A-Z]):/, (_, drive: string) => `${drive.toLowerCase()}:`);
}
