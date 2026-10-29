import assert from 'node:assert/strict';
import { matchesQuery } from '../../../../src/server/syntax/workspaceSymbols.ts';

describe('server/syntax/workspaceSymbols matchesQuery', () => {
  it('matches everything for an empty query', () => {
    assert.equal(matchesQuery('anything', ''), true);
  });

  it('matches the characters of the query in order, case-insensitively', () => {
    assert.equal(matchesQuery('Infinity_PushMenu', 'ipm'), true);
    assert.equal(matchesQuery('Infinity_PushMenu', 'PUSH'), true);
    assert.equal(matchesQuery('Infinity_PushMenu', 'mpi'), false);
    assert.equal(matchesQuery('abc', 'abcd'), false);
  });

  it('does not reuse a character of the name for two characters of the query', () => {
    assert.equal(matchesQuery('ab', 'aa'), false);
    assert.equal(matchesQuery('aab', 'aa'), true);
  });
});
