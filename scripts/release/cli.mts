// Release automation used by .github/workflows/release.yml (also runnable locally).
//
//   node scripts/release/cli.mts prepare --channel <pre-release|stable>
//       Computes the next version from git tags + Conventional Commits (the first
//       stable release is VERSION itself), then updates VERSION, package.json,
//       package-lock.json, CHANGELOG.md and docs/CHANGELOG.vsix.md.
//   node scripts/release/cli.mts verify [--notes <file>]
//       Checks that the committed version is consistent and not yet released, and
//       optionally writes the CHANGELOG.md section of that version to <file>.
//   node scripts/release/cli.mts install-size --vsix <file> (--write | --check) [--notes <file>]
//       Computes the size VS Code shows for the extension once <file> is installed
//       (scripts/release/vsix.mts) and writes it to, or checks it against, the
//       README badge data in .github/badges/install-size.json. The check compares
//       what the badge shows (VS Code's rounding to 0.01 KB): shields.io rejects
//       extra keys, so the exact byte count is printed, and appended to the
//       release notes file given with --notes.
//
// On GitHub Actions both commands append `version`, `tag` and `channel` to $GITHUB_OUTPUT.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promoteUnreleased, releaseBody, unreleasedBody } from './changelog.mts';
import {
  bumpFromCommits,
  channelOf,
  compareVersions,
  formatVersion,
  latestTaggedVersion,
  parseVersion,
  releaseVersion,
  type Channel,
  type Version,
} from './version.mts';
import { formatSize, installedSize, installSizeBadge, zipEntries } from './vsix.mts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPOSITORY_URL = 'https://github.com/4Luke4/IE-Lua-Language-Server';
const CHANGELOGS = ['CHANGELOG.md', join('docs', 'CHANGELOG.vsix.md')];
/** shields.io endpoint data of the README's install-size badge, for the latest release. */
const INSTALL_SIZE_BADGE = join('.github', 'badges', 'install-size.json');

function fail(message: string): never {
  console.error(`::error title=Release::${message}`);
  process.exit(1);
}

function git(...args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
    fail(`\`git ${args.join(' ')}\` failed: ${stderr || (error instanceof Error ? error.message : String(error))}`);
  }
}

function read(file: string): string {
  return readFileSync(join(root, file), 'utf8');
}

function output(values: Record<string, string>): void {
  const file = process.env['GITHUB_OUTPUT'];
  for (const [key, value] of Object.entries(values)) {
    console.log(`${key}=${value}`);
    if (file) {
      appendFileSync(file, `${key}=${value}\n`);
    }
  }
}

/** VERSION, package.json and package-lock.json must all hold the same version. */
function committedVersion(): Version {
  const fromFile = read('VERSION').trim();
  const manifest = JSON.parse(read('package.json')) as { version?: string };
  const lock = JSON.parse(read('package-lock.json')) as { version?: string; packages?: Record<string, { version?: string }> };
  const values = {
    VERSION: fromFile,
    'package.json': manifest.version,
    'package-lock.json': lock.version,
    'package-lock.json packages[""]': lock.packages?.['']?.version,
  };
  const distinct = new Set(Object.values(values));
  if (distinct.size !== 1) {
    fail(`Version mismatch: ${Object.entries(values).map(([file, value]) => `${file}=${String(value)}`).join(', ')}. They must be identical.`);
  }
  const version = parseVersion(fromFile);
  if (!version) {
    fail(`VERSION contains "${fromFile}", which is not major.minor.patch (VS Code does not support pre-release tags).`);
  }
  return version;
}

function tags(): string[] {
  return git('tag', '--list', 'v*').split('\n').filter(Boolean);
}

function prepare(channel: Channel): void {
  const current = committedVersion();
  const allTags = tags();
  const latest = latestTaggedVersion(allTags);
  if (latest && compareVersions(current, latest) !== 0) {
    fail(`VERSION is ${formatVersion(current)} but the latest tag is v${formatVersion(latest)}. Run prepare only from a commit where they match.`);
  }
  for (const file of CHANGELOGS) {
    const body = unreleasedBody(read(file));
    if (body === undefined) {
      fail(`${file} has no "## [Unreleased]" section.`);
    }
    if (body === '') {
      fail(`${file} has an empty "## [Unreleased]" section. Describe the changes before releasing.`);
    }
  }
  const range = latest ? `v${formatVersion(latest)}..HEAD` : 'HEAD';
  const messages = git('log', '--format=%B%x00', range).split('\0').map((m) => m.trim()).filter(Boolean);
  const bump = bumpFromCommits(messages);
  if (!bump) {
    fail(`No feat/fix/perf/revert or breaking commit since ${latest ? `v${formatVersion(latest)}` : 'the first commit'}; there is nothing to release.`);
  }
  let next: string;
  try {
    next = formatVersion(releaseVersion(latest, current, bump, channel));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const date = new Date().toISOString().slice(0, 10);
  const previousTag = latest ? `v${formatVersion(latest)}` : undefined;

  writeFileSync(join(root, 'VERSION'), `${next}\n`);
  execFileSync('npm', ['version', next, '--no-git-tag-version', '--allow-same-version'], { cwd: root, stdio: 'inherit' });
  for (const file of CHANGELOGS) {
    writeFileSync(join(root, file), promoteUnreleased(read(file), next, date, REPOSITORY_URL, previousTag));
  }
  console.log(`Prepared ${channel} ${next} (${bump} changes since ${previousTag ?? 'the first commit'}).`);
  output({ version: next, tag: `v${next}`, channel });
}

function verify(notesFile: string | undefined): void {
  const version = committedVersion();
  const text = formatVersion(version);
  const tag = `v${text}`;
  const allTags = tags();
  if (allTags.includes(tag)) {
    fail(`Tag ${tag} already exists. Bump the version with the release workflow ("prepare") first.`);
  }
  const latest = latestTaggedVersion(allTags);
  if (latest && compareVersions(version, latest) <= 0) {
    fail(`Version ${text} must be greater than the latest released version ${formatVersion(latest)} (VS Code updates to the highest version).`);
  }
  for (const file of CHANGELOGS) {
    const body = releaseBody(read(file), text);
    if (!body) {
      fail(`${file} has no non-empty "## [${text}] - YYYY-MM-DD" section.`);
    }
  }
  if (notesFile) {
    writeFileSync(notesFile, `${releaseBody(read('CHANGELOG.md'), text) ?? ''}\n`);
  }
  console.log(`Version ${text} is consistent and unreleased.`);
  output({ version: text, tag, channel: channelOf(version) });
}

function installSize(vsixFile: string | undefined, mode: 'write' | 'check', notesFile: string | undefined): void {
  if (!vsixFile) {
    fail('install-size needs --vsix <file>.');
  }
  let size: number;
  try {
    size = installedSize(zipEntries(readFileSync(vsixFile)));
  } catch (error) {
    fail(`Cannot read the VSIX ${vsixFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const badge = `${JSON.stringify(installSizeBadge(size), null, 2)}\n`;
  console.log(`${vsixFile} installs ${String(size)} bytes, shown by VS Code as ${formatSize(size)}.`);
  if (mode === 'write') {
    writeFileSync(join(root, INSTALL_SIZE_BADGE), badge);
    console.log(`Wrote ${INSTALL_SIZE_BADGE}.`);
    return;
  }
  let committed: string;
  try {
    committed = read(INSTALL_SIZE_BADGE);
  } catch (error) {
    fail(`Cannot read ${INSTALL_SIZE_BADGE}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (committed !== badge) {
    fail(
      `${INSTALL_SIZE_BADGE} does not match ${vsixFile}, which installs ${formatSize(size)} (${String(size)} bytes). ` +
        'The badge must describe the VSIX this commit releases. On the release branch, run `npm run package`, package the VSIX ' +
        'as the Release workflow does (with --pre-release for an odd minor version), run ' +
        '`node scripts/release/cli.mts install-size --vsix <file> --write` and commit the file.',
    );
  }
  console.log(`${INSTALL_SIZE_BADGE} matches.`);
  if (notesFile) {
    appendFileSync(notesFile, `\n**Installed size:** ${String(size)} bytes (${formatSize(size)} in VS Code).\n`);
  }
}

const [command, ...args] = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

if (command === 'prepare') {
  const channel = option('--channel');
  if (channel !== 'pre-release' && channel !== 'stable') {
    fail(`--channel must be "pre-release" or "stable", got "${String(channel)}".`);
  }
  prepare(channel);
} else if (command === 'verify') {
  verify(option('--notes'));
} else if (command === 'install-size') {
  const write = args.includes('--write');
  if (write === args.includes('--check')) {
    fail('install-size needs exactly one of --write and --check.');
  }
  installSize(option('--vsix'), write ? 'write' : 'check', option('--notes'));
} else {
  fail(
    `Unknown command "${String(command)}". Use "prepare --channel <pre-release|stable>", "verify [--notes <file>]" ` +
      'or "install-size --vsix <file> (--write | --check) [--notes <file>]".',
  );
}
