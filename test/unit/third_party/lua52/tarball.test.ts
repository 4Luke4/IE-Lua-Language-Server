import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchLuaTarball, sha256, type TarballSource } from '../../../../third_party/lua52/tarball.mts';

describe('third_party/lua52/tarball fetchLuaTarball', () => {
  const good = Buffer.from('the official tarball');
  let dir: string;
  let downloads: number;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tarball-test-'));
    downloads = 0;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const source = (body: Buffer, path = join(dir, 'cache', 'lua.tar.gz')): TarballSource => ({
    url: 'https://example.invalid/lua.tar.gz',
    sha256: sha256(good),
    path,
    download: () => {
      downloads++;
      return Promise.resolve(body);
    },
  });

  it('downloads, verifies and caches the tarball when it is not cached', async () => {
    const from = source(good);
    assert.equal(await fetchLuaTarball(from), from.path);
    assert.deepEqual(readFileSync(from.path), good);
    assert.equal(downloads, 1);
  });

  it('never writes a download whose checksum is wrong', async () => {
    const from = source(Buffer.from('tampered'));
    await assert.rejects(fetchLuaTarball(from), /https:\/\/example\.invalid\/lua\.tar\.gz has SHA-256 [0-9a-f]{64}, expected [0-9a-f]{64}\. Nothing was cached\./);
    assert.equal(existsSync(from.path), false);
  });

  it('uses a verified cached file without downloading', async () => {
    const from = source(good, join(dir, 'lua.tar.gz'));
    writeFileSync(from.path, good);
    assert.equal(await fetchLuaTarball(from), from.path);
    assert.equal(downloads, 0);
  });

  it('deletes a cached file whose checksum is wrong', async () => {
    const from = source(good, join(dir, 'lua.tar.gz'));
    writeFileSync(from.path, 'corrupt');
    await assert.rejects(fetchLuaTarball(from), /The cached file was deleted; re-run to download it again\./);
    assert.equal(existsSync(from.path), false);
    assert.equal(downloads, 0);
  });

  it('passes download failures on', async () => {
    const from: TarballSource = { ...source(good), download: () => Promise.reject(new Error('HTTP 503')) };
    await assert.rejects(fetchLuaTarball(from), /HTTP 503/);
    assert.equal(existsSync(from.path), false);
  });
});
