// The official Lua 5.2.4 source tarball, downloaded once into .cache/lua and
// verified by its SHA-256 before every use. Shared by the WASM build
// (build.mts) and the Lua manual data generator (scripts/lua-manual/).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LUA_VERSION = '5.2.4';
export const LUA_URL = `https://www.lua.org/ftp/lua-${LUA_VERSION}.tar.gz`;
// Published next to the tarball on https://www.lua.org/ftp/ ("checksum (sha256)").
export const LUA_SHA256 = 'b9e2e4aad6789b3b63a056d442f7b39f0ecfca3ae0f1fc0ae4e9614401b69f4b';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Where the tarball comes from and where it is cached; injectable for tests. */
export interface TarballSource {
  readonly url: string;
  readonly sha256: string;
  /** Cache file. */
  readonly path: string;
  readonly download: (url: string) => Promise<Uint8Array>;
}

async function httpGet(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Downloading ${url} failed: HTTP ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

const OFFICIAL: TarballSource = {
  url: LUA_URL,
  sha256: LUA_SHA256,
  path: join(root, '.cache', 'lua', `lua-${LUA_VERSION}.tar.gz`),
  download: httpGet,
};

/** The file's bytes, or `undefined` when it does not exist (read directly: no exists-then-read race). */
function readIfPresent(path: string): Buffer | undefined {
  try {
    return readFileSync(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Path of the verified tarball, downloading it first when it is not cached.
 * A download is checked against the published SHA-256 in memory and written
 * to the cache only when it matches. Throws an `Error` with an actionable
 * message when the download fails or a checksum does not match (a bad cached
 * file is then deleted).
 */
export async function fetchLuaTarball(source: TarballSource = OFFICIAL): Promise<string> {
  const cached = readIfPresent(source.path);
  if (cached) {
    const actual = sha256(cached);
    if (actual !== source.sha256) {
      rmSync(source.path, { force: true });
      throw new Error(`${source.path} has SHA-256 ${actual}, expected ${source.sha256}. The cached file was deleted; re-run to download it again.`);
    }
    return source.path;
  }
  const data = Buffer.from(await source.download(source.url));
  const actual = sha256(data);
  if (actual !== source.sha256) {
    throw new Error(`${source.url} has SHA-256 ${actual}, expected ${source.sha256}. Nothing was cached.`);
  }
  mkdirSync(dirname(source.path), { recursive: true });
  writeFileSync(source.path, data);
  return source.path;
}

/** The bytes of one member of the tarball (`member` as listed by `tar -t`, e.g. `lua-5.2.4/doc/manual.html`). */
export function readTarballMember(path: string, member: string): Buffer {
  return execFileSync('tar', ['-xzOf', path, member], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
