import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OFFICIAL, writeLuaJitSource, type GitSource } from '../../../../third_party/luajit/source.mts';

// A local repository stands in for GitHub: the same git commands run, without a network.
describe('third_party/luajit/source writeLuaJitSource', () => {
  let dir: string;
  let remote: string;

  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' }).trim();

  /** Commits `files` (path → content) plus a file outside the subtree; returns the commit and subtree ids. */
  const commit = (files: Record<string, string>): { commit: string; tree: string } => {
    for (const [path, content] of Object.entries(files)) {
      const target = join(remote, path);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, content);
    }
    git(remote, 'add', '-A');
    git(remote, 'commit', '--quiet', '-m', 'fixture');
    return { commit: git(remote, 'rev-parse', 'HEAD'), tree: git(remote, 'rev-parse', 'HEAD:LuaJIT') };
  };

  const source = (pin: { commit: string; tree: string }, overrides: Partial<GitSource> = {}): GitSource => ({
    ...OFFICIAL,
    url: `file://${remote}`,
    commit: pin.commit,
    tree: pin.tree,
    cache: join(dir, 'cache'),
    ...overrides,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'luajit-source-test-'));
    remote = join(dir, 'remote');
    mkdirSync(remote);
    git(remote, 'init', '--quiet');
    // A blob-less fetch must be allowed by the serving side, as GitHub allows it.
    git(remote, 'config', 'uploadpack.allowFilter', 'true');
    git(remote, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the committed bytes of the subtree only, whatever the line endings', () => {
    const pin = commit({ 'LuaJIT/src/lj_lex.c': 'int x;\r\n', 'LuaJIT/COPYRIGHT': 'MIT\n', 'Other/file.txt': 'not wanted\n' });
    const out = join(dir, 'out');
    writeLuaJitSource(out, source(pin));
    assert.equal(readFileSync(join(out, 'src', 'lj_lex.c'), 'utf8'), 'int x;\r\n');
    assert.equal(readFileSync(join(out, 'COPYRIGHT'), 'utf8'), 'MIT\n');
    assert.equal(existsSync(join(out, 'file.txt')), false);
  });

  it('keeps the executable bit', () => {
    const pin = commit({ 'LuaJIT/build.sh': '#!/bin/sh\n' });
    git(remote, 'update-index', '--chmod=+x', 'LuaJIT/build.sh');
    git(remote, 'commit', '--quiet', '-m', 'chmod');
    const executable = { commit: git(remote, 'rev-parse', 'HEAD'), tree: git(remote, 'rev-parse', 'HEAD:LuaJIT') };
    assert.notEqual(executable.tree, pin.tree);
    const out = join(dir, 'out');
    writeLuaJitSource(out, source(executable));
    assert.equal(statSync(join(out, 'build.sh')).mode & 0o111, 0o111);
  });

  it('uses the cache without fetching again', () => {
    const pin = commit({ 'LuaJIT/a.c': 'a\n' });
    writeLuaJitSource(join(dir, 'first'), source(pin));
    writeLuaJitSource(join(dir, 'second'), source(pin, { url: 'file:///nonexistent/repository' }));
    assert.equal(readFileSync(join(dir, 'second', 'a.c'), 'utf8'), 'a\n');
  });

  it('refuses a tree that does not match the pin and deletes the cache', () => {
    const pin = commit({ 'LuaJIT/a.c': 'a\n' });
    const wrong = { ...pin, tree: '0'.repeat(40) };
    assert.throws(
      () => { writeLuaJitSource(join(dir, 'out'), source(wrong)); },
      new RegExp(`:LuaJIT has tree ${pin.tree}, expected ${'0'.repeat(40)}\\. The cache was deleted; re-run to fetch it again\\.`),
    );
    assert.equal(existsSync(join(dir, 'cache')), false);
    assert.equal(existsSync(join(dir, 'out')), false);
  });

  it('refuses a symbolic link in the subtree', () => {
    commit({ 'LuaJIT/a.c': 'a\n' });
    symlinkSync('a.c', join(remote, 'LuaJIT', 'link.c'));
    git(remote, 'add', '-A');
    git(remote, 'commit', '--quiet', '-m', 'link');
    const pin = { commit: git(remote, 'rev-parse', 'HEAD'), tree: git(remote, 'rev-parse', 'HEAD:LuaJIT') };
    assert.throws(() => { writeLuaJitSource(join(dir, 'out'), source(pin)); }, /LuaJIT\/link\.c is a blob with mode 120000; only regular files are expected\./);
  });

  it('reports a failed fetch with git’s own message', () => {
    const pin = { commit: '1'.repeat(40), tree: '2'.repeat(40) };
    assert.throws(() => { writeLuaJitSource(join(dir, 'out'), source(pin)); }, /`git fetch --quiet --depth=1 --filter=blob:none origin 1{40}` failed: /);
  });

  it('pins the commit of the LuaJIT manual data', async () => {
    const { INFINITY_LOADER_COMMIT } = await import('../../../../scripts/luajit-manual/generate.mts');
    assert.equal(OFFICIAL.commit, INFINITY_LOADER_COMMIT);
    assert.equal(OFFICIAL.url, 'https://github.com/Bubb13/InfinityLoader.git');
  });
});
