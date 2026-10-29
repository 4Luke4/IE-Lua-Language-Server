import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeFileSystem } from '../../../../src/server/workspace/nodeFileSystem.ts';

describe('server/workspace/nodeFileSystem', () => {
  let root: string;
  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'ie-lua-fs-'));
    await mkdir(join(root, 'dir'));
    await writeFile(join(root, 'a.lua'), 'x = 1');
    await symlink(join(root, 'dir'), join(root, 'dir-link'));
    await symlink(join(root, 'a.lua'), join(root, 'link.lua'));
  });
  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists files, directories and symbolic links without following links', async () => {
    const entries = (await nodeFileSystem.readDirectory(root)).sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(entries, [
      { name: 'a.lua', kind: 'file' },
      { name: 'dir', kind: 'directory' },
      { name: 'dir-link', kind: 'symlink' },
      { name: 'link.lua', kind: 'symlink' },
    ]);
  });

  it('reads a file, following a link to it', async () => {
    assert.equal(new TextDecoder().decode(await nodeFileSystem.readFile(join(root, 'link.lua'))), 'x = 1');
  });

  it('rejects with the Node error code for a missing path', async () => {
    await assert.rejects(nodeFileSystem.readFile(join(root, 'missing.lua')), { code: 'ENOENT' });
  });
});
