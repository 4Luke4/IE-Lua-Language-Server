// The official Lua 5.2.4 source tarball, downloaded once into .cache/lua and
// verified by its SHA-256 before every use. Shared by the WASM build
// (build.mts) and the Lua manual data generator (scripts/lua-manual/).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LUA_VERSION = '5.2.4';
export const LUA_URL = `https://www.lua.org/ftp/lua-${LUA_VERSION}.tar.gz`;
// Published next to the tarball on https://www.lua.org/ftp/ ("checksum (sha256)").
export const LUA_SHA256 = 'b9e2e4aad6789b3b63a056d442f7b39f0ecfca3ae0f1fc0ae4e9614401b69f4b';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cacheDir = join(root, '.cache', 'lua');
const tarball = join(cacheDir, `lua-${LUA_VERSION}.tar.gz`);

export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Path of the verified tarball, downloading it first when it is not cached.
 * Throws an `Error` with an actionable message when the download fails or the
 * file does not have the published SHA-256 (the bad file is then deleted).
 */
export async function fetchLuaTarball(): Promise<string> {
  if (!existsSync(tarball)) {
    mkdirSync(cacheDir, { recursive: true });
    const response = await fetch(LUA_URL);
    if (!response.ok) {
      throw new Error(`Downloading ${LUA_URL} failed: HTTP ${response.status} ${response.statusText}`);
    }
    writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
  }
  const actual = sha256(readFileSync(tarball));
  if (actual !== LUA_SHA256) {
    rmSync(tarball);
    throw new Error(`${LUA_URL} has SHA-256 ${actual}, expected ${LUA_SHA256}. The cached file was deleted; re-run to download it again.`);
  }
  return tarball;
}

/** The bytes of one member of the tarball (`member` as listed by `tar -t`, e.g. `lua-5.2.4/doc/manual.html`). */
export function readTarballMember(path: string, member: string): Buffer {
  return execFileSync('tar', ['-xzOf', path, member], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
