// The LuaJIT sources EEex's "Use LuaJIT" component is built from: the `LuaJIT/`
// directory of Bubb13/InfinityLoader at the commit the LuaJIT manual data is
// generated from (scripts/luajit-manual/generate.mts), so both describe one build.
//
// The directory is fetched with git and verified by its tree hash: git names every
// object by the hash of its content, so a matching tree hash covers every file below
// it. The files are written from the git objects themselves, byte for byte, so no
// checkout setting (line endings, attributes) can change them.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INFINITY_LOADER, INFINITY_LOADER_COMMIT } from '../../scripts/luajit-manual/generate.mts';

/** `git rev-parse INFINITY_LOADER_COMMIT:LuaJIT`. Update together with the commit. */
export const LUAJIT_TREE = 'f6bd614c629d5a75c536c47469919dd740d90a47';
export const LUAJIT_SUBTREE = 'LuaJIT';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Runs git with `args` in `cwd` and returns stdout; injectable for tests. */
export type Git = (args: readonly string[], cwd: string, input?: Buffer) => Buffer;

export interface GitSource {
  readonly url: string;
  readonly commit: string;
  readonly subtree: string;
  readonly tree: string;
  /** Git repository used as the download cache (objects only, no checkout). */
  readonly cache: string;
  readonly git: Git;
}

const runGit: Git = (args, cwd, input) => {
  try {
    return execFileSync('git', args, { cwd, input, maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error('`git` was not found on PATH; it is needed to fetch the pinned LuaJIT sources.', { cause: error });
    }
    const stderr = error instanceof Error && 'stderr' in error && Buffer.isBuffer(error.stderr) ? error.stderr.toString('utf8').trim() : '';
    throw new Error(`\`git ${args.join(' ')}\` failed: ${stderr || (error instanceof Error ? error.message : String(error))}`, { cause: error });
  }
};

export const OFFICIAL: GitSource = {
  url: `https://github.com/${INFINITY_LOADER}.git`,
  commit: INFINITY_LOADER_COMMIT,
  subtree: LUAJIT_SUBTREE,
  tree: LUAJIT_TREE,
  cache: join(root, '.cache', 'luajit-src', INFINITY_LOADER_COMMIT),
  git: runGit,
};

const text = (output: Buffer): string => output.toString('utf8').trim();

/** The tree id of `subtree` at `commit` in the cache, or `undefined` if the cache lacks the commit. */
function cachedTree(source: GitSource): string | undefined {
  try {
    return text(source.git(['rev-parse', '--verify', '--quiet', `${source.commit}^{commit}:${source.subtree}`], source.cache));
  } catch {
    return undefined;
  }
}

/** Fetches only the commit, and only the blobs below `subtree` (sparse, blob-less clone). */
function download(source: GitSource): void {
  rmSync(source.cache, { recursive: true, force: true });
  mkdirSync(source.cache, { recursive: true });
  const git = (...args: string[]): Buffer => source.git(args, source.cache);
  git('init', '--quiet');
  git('remote', 'add', 'origin', source.url);
  git('fetch', '--quiet', '--depth=1', '--filter=blob:none', 'origin', source.commit);
  // A sparse checkout downloads the subtree's blobs in one batch; the checked-out
  // files are not used (see writeTree).
  git('sparse-checkout', 'set', '--no-cone', `/${source.subtree}/`);
  git('-c', 'advice.detachedHead=false', 'checkout', '--quiet', source.commit);
}

interface Entry {
  readonly mode: string;
  readonly oid: string;
  readonly path: string;
}

/** Writes every file of `tree` below `destination`, from the git objects. */
function writeTree(source: GitSource, destination: string): void {
  const listing = source.git(['ls-tree', '-r', '-z', '--full-tree', source.tree], source.cache).toString('utf8');
  const entries: Entry[] = [];
  for (const record of listing.split('\0')) {
    if (record === '') continue;
    const match = /^(\d{6}) (\w+) ([0-9a-f]{40})\t(.+)$/s.exec(record);
    if (!match?.[1] || !match[2] || !match[3] || !match[4]) {
      throw new Error(`Unexpected \`git ls-tree\` record: ${JSON.stringify(record)}`);
    }
    const [, mode, type, oid, path] = match;
    // Regular files only: a link or submodule would need a decision this script does not make.
    if (type !== 'blob' || (mode !== '100644' && mode !== '100755')) {
      throw new Error(`${source.subtree}/${path} is a ${type} with mode ${mode}; only regular files are expected.`);
    }
    if (path.split('/').some((part) => part === '..' || part === '.' || part === '')) {
      throw new Error(`${source.subtree}/${path} is not a plain relative path.`);
    }
    entries.push({ mode, oid, path });
  }
  const batch = source.git(['cat-file', '--batch'], source.cache, Buffer.from(entries.map((entry) => `${entry.oid}\n`).join('')));
  let offset = 0;
  for (const entry of entries) {
    const end = batch.indexOf(0x0a, offset);
    const header = batch.subarray(offset, end).toString('utf8');
    const size = /^([0-9a-f]{40}) blob (\d+)$/.exec(header);
    if (size?.[1] !== entry.oid || size[2] === undefined) {
      throw new Error(`\`git cat-file --batch\` answered "${header}" for ${entry.oid} (${entry.path}).`);
    }
    const start = end + 1;
    const length = Number(size[2]);
    const target = join(destination, ...entry.path.split('/'));
    if (!target.startsWith(destination + sep)) {
      throw new Error(`${entry.path} leaves ${destination}.`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, batch.subarray(start, start + length), { mode: entry.mode === '100755' ? 0o755 : 0o644 });
    offset = start + length + 1; // Each object is followed by a newline.
  }
  if (offset !== batch.length) {
    throw new Error('`git cat-file --batch` returned more data than requested.');
  }
}

/**
 * Writes the pinned `LuaJIT/` directory into `destination` (which must not exist yet),
 * downloading the commit first when the cache does not have it. Throws an `Error` with
 * an actionable message when git fails or the tree hash does not match (a bad cache is
 * then deleted).
 */
export function writeLuaJitSource(destination: string, source: GitSource = OFFICIAL): void {
  let tree = cachedTree(source);
  if (tree === undefined) {
    download(source);
    tree = cachedTree(source);
  }
  if (tree !== source.tree) {
    rmSync(source.cache, { recursive: true, force: true });
    throw new Error(
      `${source.url} ${source.commit}:${source.subtree} has tree ${tree ?? '(missing)'}, expected ${source.tree}. ` +
        'The cache was deleted; re-run to fetch it again. If the pinned commit changed, update LUAJIT_TREE.',
    );
  }
  mkdirSync(destination, { recursive: false });
  writeTree(source, destination);
}
