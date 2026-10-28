import assert from 'node:assert/strict';
import {
  bumpFromCommits,
  channelOf,
  formatVersion,
  latestTaggedVersion,
  nextVersion,
  parseVersion,
  type Bump,
  type Channel,
} from '../../../../scripts/release/version.mts';

const v = (text: string) => {
  const version = parseVersion(text);
  assert.ok(version, text);
  return version;
};
const next = (latest: string, bump: Bump, channel: Channel) => formatVersion(nextVersion(v(latest), bump, channel));

describe('scripts/release/version', () => {
  it('parses only plain major.minor.patch, as VS Code requires', () => {
    assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3 });
    for (const bad of ['1.2', '1.2.3-beta.1', '01.2.3', 'v1.2.3', '1.2.3+build']) {
      assert.equal(parseVersion(bad), undefined, bad);
    }
  });

  it('maps even minors to stable and odd minors to pre-release', () => {
    assert.equal(channelOf(v('1.4.0')), 'stable');
    assert.equal(channelOf(v('1.5.2')), 'pre-release');
  });

  it('finds the highest vX.Y.Z tag and ignores others', () => {
    assert.deepEqual(latestTaggedVersion(['v0.2.0', 'v0.10.1', 'v0.3.4', 'nightly', 'v1.0.0-rc.1']), v('0.10.1'));
    assert.equal(latestTaggedVersion([]), undefined);
  });

  describe('bumpFromCommits', () => {
    it('returns the largest Conventional Commits bump', () => {
      assert.equal(bumpFromCommits(['fix: a', 'docs: b']), 'patch');
      assert.equal(bumpFromCommits(['fix: a', 'feat(server): b']), 'minor');
      assert.equal(bumpFromCommits(['feat!: drop x']), 'major');
      assert.equal(bumpFromCommits(['refactor: y\n\nBREAKING CHANGE: setting renamed']), 'major');
      assert.equal(bumpFromCommits(['perf: faster']), 'patch');
    });

    it('returns undefined when nothing is releasable', () => {
      assert.equal(bumpFromCommits(['docs: a', 'ci: b', 'chore(deps): c', 'not conventional']), undefined);
    });
  });

  describe('nextVersion', () => {
    it('opens and continues an odd pre-release line', () => {
      assert.equal(next('0.0.0', 'minor', 'pre-release'), '0.1.0');
      assert.equal(next('0.1.0', 'minor', 'pre-release'), '0.1.1');
      assert.equal(next('0.2.3', 'patch', 'pre-release'), '0.3.0');
    });

    it('promotes a pre-release line to the next even minor', () => {
      assert.equal(next('0.1.4', 'patch', 'stable'), '0.2.0');
    });

    it('bumps inside a stable line by feature or fix', () => {
      assert.equal(next('0.2.0', 'patch', 'stable'), '0.2.1');
      assert.equal(next('0.2.1', 'minor', 'stable'), '0.4.0');
      assert.equal(next('0.0.0', 'patch', 'stable'), '0.0.1');
    });

    it('treats breaking changes as a minor bump while the major is 0', () => {
      assert.equal(next('0.2.0', 'major', 'stable'), '0.4.0');
      assert.equal(next('0.2.0', 'major', 'pre-release'), '0.3.0');
    });

    it('opens a new major with the right parity', () => {
      assert.equal(next('1.4.2', 'major', 'stable'), '2.0.0');
      assert.equal(next('1.4.2', 'major', 'pre-release'), '2.1.0');
    });

    it('always returns a greater version with the parity of the channel', () => {
      const versions = ['0.0.0', '0.1.0', '0.2.5', '1.3.1', '2.0.0'];
      for (const latest of versions) {
        for (const bump of ['major', 'minor', 'patch'] as const) {
          for (const channel of ['stable', 'pre-release'] as const) {
            const result = nextVersion(v(latest), bump, channel);
            const label = `${latest} ${bump} ${channel} -> ${formatVersion(result)}`;
            assert.ok(formatVersion(result) !== latest && (result.major > v(latest).major || result.minor > v(latest).minor || result.patch > v(latest).patch), label);
            assert.equal(channelOf(result), channel, label);
          }
        }
      }
    });
  });
});
