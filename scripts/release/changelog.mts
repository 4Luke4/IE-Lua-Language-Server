// Pure Keep a Changelog 1.1.0 helpers (https://keepachangelog.com/en/1.1.0/).
// Both CHANGELOG.md (GitHub, detailed) and docs/CHANGELOG.vsix.md (shipped in the
// VSIX, user-facing) use the same structure, so the same functions apply to both.

const UNRELEASED = /^## \[Unreleased\][^\S\n]*$/m;
const SECTION = /^## \[/m;

/** Body of the `## [Unreleased]` section, trimmed; `undefined` if the heading is missing. */
export function unreleasedBody(changelog: string): string | undefined {
  const heading = UNRELEASED.exec(changelog);
  if (!heading) {
    return undefined;
  }
  const rest = changelog.slice(heading.index + heading[0].length);
  const next = SECTION.exec(rest);
  const linksStart = /^\[[^\]]+\]: /m.exec(rest);
  const end = Math.min(next?.index ?? rest.length, linksStart?.index ?? rest.length);
  return rest.slice(0, end).trim();
}

/** Body of `## [<version>] - <date>`, trimmed; `undefined` if absent. */
export function releaseBody(changelog: string, version: string): string | undefined {
  const heading = new RegExp(`^## \\[${version.replaceAll('.', '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}[^\\S\\n]*$`, 'm').exec(changelog);
  if (!heading) {
    return undefined;
  }
  const rest = changelog.slice(heading.index + heading[0].length);
  const next = SECTION.exec(rest);
  const linksStart = /^\[[^\]]+\]: /m.exec(rest);
  const end = Math.min(next?.index ?? rest.length, linksStart?.index ?? rest.length);
  return rest.slice(0, end).trim();
}

/**
 * Turns `## [Unreleased]` into `## [<version>] - <date>` under a new, empty
 * `## [Unreleased]`, and rewrites the comparison links at the bottom.
 * `previousTag` is undefined for the first release.
 */
export function promoteUnreleased(changelog: string, version: string, date: string, repositoryUrl: string, previousTag: string | undefined): string {
  if (!UNRELEASED.test(changelog)) {
    throw new Error('The changelog has no "## [Unreleased]" heading.');
  }
  const tag = `v${version}`;
  let text = changelog.replace(UNRELEASED, `## [Unreleased]\n\n## [${version}] - ${date}`);
  text = text.replace(/^\[Unreleased\]: .*$/m, '').trimEnd();
  const versionLink = previousTag ? `${repositoryUrl}/compare/${previousTag}...${tag}` : `${repositoryUrl}/releases/tag/${tag}`;
  const links = [`[Unreleased]: ${repositoryUrl}/compare/${tag}...HEAD`, `[${version}]: ${versionLink}`];
  // Keep older version links after the new ones.
  const firstLink = /^\[\d+\.\d+\.\d+\]: /m.exec(text);
  if (firstLink) {
    return `${text.slice(0, firstLink.index)}${links.join('\n')}\n${text.slice(firstLink.index)}\n`;
  }
  return `${text}\n\n${links.join('\n')}\n`;
}
