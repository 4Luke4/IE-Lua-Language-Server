// Keeps data/eeex/<section>.json in step with the published EEex documentation.
//
//   node scripts/eeex-docs/sync.mts <section> --check   only report whether upstream changed
//   node scripts/eeex-docs/sync.mts <section>           regenerate the data file
//
// <section>: eeex-functions | game-lua-functions | game-structures-x64
//
// Upstream (https://github.com/Bubb13/EEex-Docs) has no releases and no license.
// "New stable release" therefore means: the newest *successful* Read the Docs
// build of the `latest` version (the master branch) changed this section's
// sources. Only names and deep links are stored; no documentation text is copied.
// Names and URLs come from that build's Sphinx inventory (objects.inv), which is
// the authority on the anchors Sphinx generated.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS_BASE, parseInventory, sectionEntries } from './inventory.mts';

const SECTIONS = {
  'eeex-functions': { title: 'EEex Functions', directory: 'EEex Functions' },
  'game-lua-functions': { title: 'EE Game Lua Functions', directory: 'EE Game Lua Functions' },
  'game-structures-x64': { title: 'EE Game Structures (x64)', directory: 'EE Game Structures (x64)' },
} as const;
type SectionId = keyof typeof SECTIONS;

const REPOSITORY = 'Bubb13/EEex-Docs';
const BUILDS_API = 'https://readthedocs.org/api/v3/projects/eeex-docs/builds/?limit=50';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface EeexDataFile {
  readonly section: string;
  readonly title: string;
  readonly upstream: {
    readonly repository: string;
    /** Commit of the Read the Docs build the entries were taken from. */
    readonly buildCommit: string;
    /** Last commit that touched source/<directory>/ at buildCommit. */
    readonly sourceCommit: string;
  };
  readonly entries: readonly { readonly name: string; readonly url: string }[];
}

function fail(message: string): never {
  console.error(`::error title=EEex docs sync::${message}`);
  process.exit(1);
}

/** How many times a throttled (HTTP 429) request is retried after the wait the server asks for. */
const MAX_THROTTLE_RETRIES = 3;

/**
 * Seconds the server asked us to wait: the standard `Retry-After` header, or
 * Read the Docs' `{"detail": "… Expected available in N seconds."}` body.
 */
async function requestedDelaySeconds(response: Response): Promise<number | undefined> {
  const header = Number(response.headers.get('retry-after'));
  if (Number.isFinite(header) && header >= 0) {
    return header;
  }
  const detail = /Expected available in (\d+) seconds?/.exec(await response.text());
  return detail?.[1] ? Number(detail[1]) : undefined;
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  let response = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
  for (let attempt = 1; response.status === 429 && attempt <= MAX_THROTTLE_RETRIES; attempt++) {
    const seconds = await requestedDelaySeconds(response);
    if (seconds === undefined) {
      break;
    }
    console.log(`GET ${url} was throttled; retrying in ${seconds} s as requested by the server (attempt ${attempt}/${MAX_THROTTLE_RETRIES}).`);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    response = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
  }
  if (!response.ok) {
    // The body may already have been read while looking for a retry delay.
    const body = response.bodyUsed ? '' : await response.text();
    fail(`GET ${url} failed: HTTP ${response.status} ${response.statusText}\n${body}`);
  }
  return response.json();
}

function githubHeaders(): Record<string, string> {
  const token = process.env['GITHUB_TOKEN'];
  return token ? { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' } : {};
}

/** Commit of the newest successful, finished build of the `latest` version. */
async function latestBuildCommit(): Promise<string> {
  const data = (await getJson(BUILDS_API)) as {
    results?: { version?: string; success?: boolean; commit?: string; state?: { code?: string } }[];
  };
  const build = data.results?.find((b) => b.version === 'latest' && b.success === true && b.state?.code === 'finished' && b.commit);
  if (!build?.commit) {
    fail(`No successful "latest" build found in the 50 most recent Read the Docs builds (${BUILDS_API}).`);
  }
  return build.commit;
}

async function lastSourceCommit(directory: string, at: string): Promise<string> {
  const url = `https://api.github.com/repos/${REPOSITORY}/commits?sha=${at}&per_page=1&path=${encodeURIComponent(`source/${directory}`)}`;
  const commits = (await getJson(url, githubHeaders())) as { sha?: string }[];
  const sha = commits[0]?.sha;
  if (!sha) {
    fail(`No commit touches source/${directory}/ at ${at}; has the section been renamed upstream?`);
  }
  return sha;
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

async function main(): Promise<void> {
  const [id, flag] = process.argv.slice(2);
  if (!id || !(id in SECTIONS)) {
    fail(`Unknown section "${String(id)}". Use one of: ${Object.keys(SECTIONS).join(', ')}.`);
  }
  const section = SECTIONS[id as SectionId];
  const file = join(root, 'data', 'eeex', `${id}.json`);
  const recorded = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as EeexDataFile).upstream.sourceCommit : undefined;

  const buildCommit = await latestBuildCommit();
  const sourceCommit = await lastSourceCommit(section.directory, buildCommit);
  const changed = sourceCommit !== recorded;
  console.log(`${section.title}: recorded ${recorded ?? '(none)'}, published ${sourceCommit} (Read the Docs build of ${buildCommit}).`);
  output({ changed: String(changed), source_commit: sourceCommit, build_commit: buildCommit });
  if (flag === '--check' || !changed) {
    return;
  }

  const inventoryUrl = `${DOCS_BASE}objects.inv`;
  const response = await fetch(inventoryUrl);
  if (!response.ok) {
    fail(`GET ${inventoryUrl} failed: HTTP ${response.status} ${response.statusText}`);
  }
  // The inventory is served from the newest build; make sure it is the one we checked.
  if (buildCommit !== (await latestBuildCommit())) {
    fail('A new Read the Docs build finished while syncing. Re-run the workflow.');
  }
  const entries = sectionEntries(parseInventory(Buffer.from(await response.arrayBuffer())), section.directory);
  if (entries.length === 0) {
    fail(`objects.inv has no entries under "${section.directory}/"; refusing to write an empty data file.`);
  }
  const data: EeexDataFile = {
    section: id,
    title: section.title,
    upstream: { repository: `https://github.com/${REPOSITORY}`, buildCommit, sourceCommit },
    entries,
  };
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Wrote ${entries.length} entries to data/eeex/${id}.json.`);
}

await main();
