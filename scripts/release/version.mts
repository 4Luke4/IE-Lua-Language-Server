// Pure release-version logic (unit-tested in test/unit/scripts/release/).
//
// VS Code rules (https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions):
//  - versions are plain major.minor.patch; SemVer pre-release tags are not supported;
//  - recommended: even minor = release, odd minor = pre-release;
//  - pre-release and release versions must differ, and VS Code updates users to
//    the highest version, so every new version must exceed every published one.
// Bump size follows Conventional Commits 1.0.0 (https://www.conventionalcommits.org/en/v1.0.0/).

export type Channel = 'pre-release' | 'stable';
export type Bump = 'major' | 'minor' | 'patch';

export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseVersion(text: string): Version | undefined {
  const match = VERSION.exec(text.trim());
  if (!match) {
    return undefined;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function formatVersion({ major, minor, patch }: Version): string {
  return `${major}.${minor}.${patch}`;
}

export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** The channel a version belongs to under the even/odd minor convention. */
export function channelOf(version: Version): Channel {
  return version.minor % 2 === 0 ? 'stable' : 'pre-release';
}

/** Highest `vX.Y.Z` tag; other tags are ignored. */
export function latestTaggedVersion(tags: readonly string[]): Version | undefined {
  return tags
    .map((tag) => (tag.startsWith('v') ? parseVersion(tag.slice(1)) : undefined))
    .filter((version): version is Version => version !== undefined)
    .sort(compareVersions)
    .at(-1);
}

const HEADER = /^(?<type>[a-z]+)(?:\([^)]*\))?(?<breaking>!)?: .+/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: /m;
/** Commit types that change what users get; anything else alone is not worth a release. */
const RELEASABLE = new Set(['feat', 'fix', 'perf', 'revert']);

/**
 * Largest bump implied by the commit messages, or `undefined` when no commit is
 * releasable. Messages that do not follow Conventional Commits are ignored
 * (commitlint rejects them before they reach main).
 */
export function bumpFromCommits(messages: readonly string[]): Bump | undefined {
  let bump: Bump | undefined;
  for (const message of messages) {
    const header = HEADER.exec(message.split('\n', 1)[0] ?? '');
    const type = header?.groups?.['type'];
    if (!header || type === undefined) {
      continue;
    }
    if (header.groups?.['breaking'] === '!' || BREAKING_FOOTER.test(message)) {
      return 'major';
    }
    if (type === 'feat') {
      bump = 'minor';
    } else if (RELEASABLE.has(type) && bump === undefined) {
      bump = 'patch';
    }
  }
  return bump;
}

/**
 * Next version for `channel`, strictly greater than `latest` (the highest version
 * ever tagged, of either channel) and with the minor parity of `channel`.
 *
 * - Breaking change: next major (`x.0.0` stable, `x.1.0` pre-release). While the
 *   major is 0, SemVer treats any change as possibly breaking, so it is a minor bump.
 * - Pre-release: patch bump inside an odd line, otherwise open the next odd minor.
 * - Stable: promote an odd line to the next even minor; inside an even line a
 *   feature opens the next even minor and a fix bumps the patch.
 */
export function nextVersion(latest: Version, bump: Bump, channel: Channel): Version {
  const effective: Bump = bump === 'major' && latest.major === 0 ? 'minor' : bump;
  if (effective === 'major') {
    return { major: latest.major + 1, minor: channel === 'stable' ? 0 : 1, patch: 0 };
  }
  const latestChannel = channelOf(latest);
  if (channel === 'pre-release') {
    if (latestChannel === 'pre-release') {
      return { ...latest, patch: latest.patch + 1 };
    }
    return { major: latest.major, minor: latest.minor + 1, patch: 0 };
  }
  if (latestChannel === 'pre-release') {
    return { major: latest.major, minor: latest.minor + 1, patch: 0 };
  }
  if (effective === 'minor') {
    return { major: latest.major, minor: latest.minor + 2, patch: 0 };
  }
  return { ...latest, patch: latest.patch + 1 };
}
