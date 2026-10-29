import assert from 'node:assert/strict';
import { filesExcludeFilter } from '../../../../src/server/workspace/filesExclude.ts';

const noSiblings = (): boolean => false;

describe('server/workspace/filesExclude', () => {
  it('excludes paths matching an enabled pattern, relative to the folder', () => {
    const excluded = filesExcludeFilter({ '**/.git': true, 'out/**': true });
    assert.equal(excluded('.git', noSiblings), true);
    assert.equal(excluded('a/.git', noSiblings), true);
    assert.equal(excluded('out/x.lua', noSiblings), true);
    assert.equal(excluded('src/out/x.lua', noSiblings), false);
  });

  it('ignores patterns whose value is false', () => {
    assert.equal(filesExcludeFilter({ '**/*.lua': false })('a.lua', noSiblings), false);
  });

  it('excludes a match with a when clause only if the named sibling exists', () => {
    const excluded = filesExcludeFilter({ '**/*.js': { when: '$(basename).ts' } });
    const siblings = new Set(['a.ts']);
    const has = (name: string): boolean => siblings.has(name);
    assert.equal(excluded('src/a.js', has), true);
    assert.equal(excluded('src/b.js', has), false);
  });

  it('replaces only the first $(basename), with the name without its last extension', () => {
    const asked: string[] = [];
    filesExcludeFilter({ '**/*.lua': { when: '$(basename).$(basename)' } })('a.b.lua', (name) => {
      asked.push(name);
      return false;
    });
    assert.deepEqual(asked, ['a.b.$(basename)']);
  });

  it('treats any other value, such as an object without when, as enabled', () => {
    const excluded = filesExcludeFilter({ 'a.lua': { other: true }, 'b.lua': { when: 1 }, 'c.lua': 'yes' });
    for (const path of ['a.lua', 'b.lua', 'c.lua']) assert.equal(excluded(path, noSiblings), true, path);
  });

  it('excludes nothing for a value that is not an object', () => {
    for (const value of [undefined, null, true, 'x', ['**']]) {
      assert.equal(filesExcludeFilter(value)('a.lua', noSiblings), false, String(value));
    }
  });
});
