// The real file system for the workspace index (Node `fs`).
import { readdir, readFile } from 'node:fs/promises';
import type { DirectoryEntry, WorkspaceFileSystem } from './workspaceIndex.ts';

export const nodeFileSystem: WorkspaceFileSystem = {
  async readDirectory(path: string): Promise<DirectoryEntry[]> {
    // `withFileTypes` reports a symbolic link as such (lstat semantics), without following it.
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      kind: entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
    }));
  },
  readFile(path: string): Promise<Uint8Array> {
    return readFile(path);
  },
};
