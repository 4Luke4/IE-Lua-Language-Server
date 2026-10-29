import assert from 'node:assert/strict';
import { compileGlob } from '../../../../src/server/workspace/glob.ts';

/** The paths among `paths` that `pattern` matches. */
function matching(pattern: string, paths: string[]): string[] {
  const glob = compileGlob(pattern);
  return paths.filter((path) => glob?.test(path) === true);
}

describe('server/workspace/glob (VS Code files.exclude semantics)', () => {
  it('matches * and ? within one path segment only', () => {
    assert.deepEqual(matching('*.lua', ['a.lua', '.lua', 'dir/a.lua', 'a.luac']), ['a.lua', '.lua']);
    assert.deepEqual(matching('a?c', ['abc', 'ac', 'a/c', 'abbc']), ['abc']);
  });

  it('matches ** across any number of segments, including none', () => {
    const paths = ['.git', 'a/.git', 'a/b/.git', 'a.git', 'a/.git/x'];
    assert.deepEqual(matching('**/.git', paths), ['.git', 'a/.git', 'a/b/.git']);
    assert.deepEqual(matching('a/**/b', ['a/b', 'a/x/b', 'a/x/y/b', 'ab', 'a/xb']), ['a/b', 'a/x/b', 'a/x/y/b']);
    assert.deepEqual(matching('**', ['a', 'a/b']), ['a', 'a/b']);
  });

  it('matches a folder and everything under it with a trailing /**', () => {
    assert.deepEqual(matching('out/**', ['out', 'out/a', 'out/a/b', 'outside', 'x/out']), ['out', 'out/a', 'out/a/b']);
  });

  it('expands {a,b} choices, which may contain slashes and globs', () => {
    assert.deepEqual(matching('*.{lua,menu}', ['a.lua', 'a.menu', 'a.MENU', 'a.txt']), ['a.lua', 'a.menu']);
    assert.deepEqual(matching('{a/b,x*}', ['a/b', 'xyz', 'a']), ['a/b', 'xyz']);
  });

  it('matches character sets, ranges and negated sets', () => {
    assert.deepEqual(matching('[a-c].lua', ['a.lua', 'c.lua', 'd.lua']), ['a.lua', 'c.lua']);
    assert.deepEqual(matching('[!a]x', ['ax', 'bx', '/x']), ['bx', '/x']);
    assert.deepEqual(matching('[^a]x', ['ax', 'bx']), ['bx']);
    assert.deepEqual(matching('[]]', [']', 'a']), [']']);
  });

  it('is case-sensitive, like the explorer', () => {
    assert.deepEqual(matching('**/*.menu', ['UI.MENU', 'ui.menu']), ['ui.menu']);
  });

  it('accepts backslashes as separators in the matched path', () => {
    assert.deepEqual(matching('**/.git', ['a\\.git']), ['a\\.git']);
  });

  it('treats regular-expression characters literally', () => {
    assert.deepEqual(matching('a+(b).$', ['a+(b).$', 'aa(b)x$']), ['a+(b).$']);
  });

  it('trims the pattern and matches nothing when it is empty', () => {
    assert.deepEqual(matching('  *.lua ', ['a.lua']), ['a.lua']);
    assert.equal(compileGlob('   '), undefined);
  });

  it('drops an unterminated { or [ with the rest of its segment, and a stray }', () => {
    assert.deepEqual(matching('a{b', ['a', 'ab']), ['a']);
    assert.deepEqual(matching('a[b', ['a', 'ab']), ['a']);
    assert.deepEqual(matching('a}b', ['ab', 'a}b']), ['ab']);
  });

  it('matches nothing when a stray ] closes an empty set', () => {
    assert.deepEqual(matching('a]', ['a', 'a]']), []);
  });
});
