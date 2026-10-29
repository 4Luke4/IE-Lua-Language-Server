// Generates data/lua52/manual.json, the Lua 5.2 library reference shown in
// hovers, from the official manual.
//
//   npm run lua-manual                     regenerate the data file
//   npm run lua-manual -- --check          fail if the committed file differs from a fresh run
//   npm run lua-manual -- --compare-online report whether https://www.lua.org/manual/5.2/
//                                          gives the same entries (manual audit; not run in CI)
//
// Source: lua-5.2.4/doc/manual.html from the official tarball, verified by its
// published SHA-256 (third_party/lua52/tarball.mts): the same release as the
// compiler the extension embeds. The online manual is unversioned; the audit
// option checks that it still agrees.
//
// Only the libraries the game engine opens are included (CLAUDE.md, section 7;
// IESDP "Engine Lua globals"): the basic functions (§6.1), string (§6.4),
// table (§6.5), math (§6.6), bit32 (§6.7) and debug (§6.10). Coroutines (§6.2),
// modules (§6.3, including `require`), io (§6.8) and os (§6.9) are left out.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchLuaTarball, LUA_SHA256, LUA_URL, LUA_VERSION, readTarballMember } from '../../third_party/lua52/tarball.mts';
import { convertFragment, decodeEntities } from './convert.mts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const output = join(root, 'data', 'lua52', 'manual.json');

const MEMBER = `lua-${LUA_VERSION}/doc/manual.html`;
const ONLINE_URL = 'https://www.lua.org/manual/5.2/manual.html';
/** Links in the data point to the online manual, the URL plan.md names. */
const BASE_URL = ONLINE_URL;

/** The sections included, with the module table each one documents (none for the basic functions). */
const SECTIONS: readonly { readonly number: string; readonly module?: string }[] = [
  { number: '6.1' },
  { number: '6.4', module: 'string' },
  { number: '6.5', module: 'table' },
  { number: '6.6', module: 'math' },
  { number: '6.7', module: 'bit32' },
  { number: '6.10', module: 'debug' },
];

export interface ManualSection {
  readonly number: string;
  readonly title: string;
  readonly module?: string;
}

export interface ManualEntry {
  /** `print`, `string.format`, or the module name for a module. */
  readonly name: string;
  /** `function` when the heading has a parameter list, `value` otherwise (`_G`, `math.pi`); `module` for a library table. */
  readonly kind: 'function' | 'value' | 'module';
  readonly section: string;
  /** Fragment of the entry in the manual (`pdf-string.format`, or the section number for a module). */
  readonly anchor: string;
  /** The heading as the manual prints it (`string.format (formatstring, ···)`); the module name for a module. */
  readonly heading: string;
  readonly markdown: string;
  readonly plaintext: string;
}

export interface ManualData {
  readonly source: { readonly url: string; readonly sha256: string; readonly member: string; readonly encoding: 'iso-8859-1' };
  readonly title: string;
  readonly copyright: string;
  readonly baseUrl: string;
  readonly sections: readonly ManualSection[];
  readonly entries: readonly ManualEntry[];
}

class ManualFormatError extends Error {}

function expectMatch(pattern: RegExp, html: string, what: string): RegExpExecArray {
  const match = pattern.exec(html);
  if (!match) {
    throw new ManualFormatError(`${what} was not found (pattern ${String(pattern)}).`);
  }
  return match;
}

/** Library entries of the manual's HTML: the data file's content, without `source`. */
export function extract(html: string): Omit<ManualData, 'source'> {
  const title = decodeEntities(expectMatch(/<title>([^<]*)<\/title>/, html, 'The title')[1] ?? '').trim();
  const copyright = decodeEntities(expectMatch(/<small>\s*(Copyright[\s\S]*?)<\/small>/, html, 'The copyright notice')[1] ?? '')
    .replace(/<a href="[^"]*">([^<]*)<\/a>/g, '$1')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim();
  const sections: ManualSection[] = [];
  const entries: ManualEntry[] = [];
  for (const { number, module } of SECTIONS) {
    const escaped = number.replace('.', '\\.');
    const heading = expectMatch(new RegExp(`<h2>${escaped} &ndash; <a name="${escaped}">([^<]*)</a></h2>`), html, `The heading of §${number}`);
    const sectionTitle = decodeEntities(heading[1] ?? '');
    sections.push(module === undefined ? { number, title: sectionTitle } : { number, title: sectionTitle, module });
    const start = heading.index + heading[0].length;
    const next = html.slice(start).search(/<h[12]>/);
    const body = html.slice(start, next < 0 ? undefined : start + next);
    const location = (what: string): string => `§${number} ${sectionTitle}, ${what}`;

    const firstEntry = body.indexOf('<hr><h3>');
    if (firstEntry < 0) throw new ManualFormatError(`${location('entries')}: none found.`);
    if (module !== undefined) {
      const intro = body.slice(0, firstEntry);
      if (!intro.includes(`<a name="pdf-${module}">`)) {
        throw new ManualFormatError(`${location('introduction')}: no anchor "pdf-${module}" for the module table.`);
      }
      entries.push({ name: module, kind: 'module', section: number, anchor: number, heading: module, ...convert(intro, location('introduction')) });
    }

    const entryHeading = /<hr><h3><a name="pdf-([^"]+)"><code>([^<]*)<\/code><\/a><\/h3>/g;
    const rest = body.slice(firstEntry);
    for (let match = entryHeading.exec(rest); match; match = entryHeading.exec(rest)) {
      const [source, name = '', rawHeading = ''] = match;
      const entryStart = match.index + source.length;
      const end = rest.slice(entryStart).search(/<hr>|<h[1-4]>/);
      const html = rest.slice(entryStart, end < 0 ? undefined : entryStart + end);
      const expected = module === undefined ? /^[A-Za-z_][A-Za-z0-9_]*$/ : new RegExp(`^${module}\\.[A-Za-z_][A-Za-z0-9_]*$`);
      if (!expected.test(name)) {
        throw new ManualFormatError(`${location(`entry "${name}"`)}: the name does not belong to this section.`);
      }
      const entryHeadingText = decodeEntities(rawHeading).replace(/[ \t\r\n]+/g, ' ').trim();
      entries.push({
        name,
        kind: entryHeadingText.includes('(') ? 'function' : 'value',
        section: number,
        anchor: `pdf-${name}`,
        heading: entryHeadingText,
        ...convert(html, location(`entry "${name}"`)),
      });
    }
    // Every `<hr><h3>` of the section must have been an entry heading.
    const headings = rest.split('<hr><h3>').length - 1;
    const found = entries.filter((entry) => entry.section === number && entry.kind !== 'module').length;
    if (headings !== found) {
      throw new ManualFormatError(`${location('entries')}: ${headings} entry headings, but only ${found} have the expected form.`);
    }
  }
  return { title, copyright, baseUrl: BASE_URL, sections, entries };
}

function convert(html: string, location: string): { markdown: string; plaintext: string } {
  try {
    return convertFragment(html, BASE_URL);
  } catch (error) {
    throw new ManualFormatError(`${location}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function serialize(data: ManualData): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function fail(message: string, file?: string): never {
  // `::error::` renders as an annotation on GitHub Actions and reads fine locally.
  console.error(`::error${file ? ` file=${relative(root, file)},` : ' '}title=Lua manual data::${message}`);
  process.exit(1);
}

async function generate(): Promise<string> {
  const tarball = await fetchLuaTarball();
  const html = readTarballMember(tarball, MEMBER).toString('latin1');
  return serialize({ source: { url: LUA_URL, sha256: LUA_SHA256, member: MEMBER, encoding: 'iso-8859-1' }, ...extract(html) });
}

/** Differences between the entries of the tarball's manual and the online one, as readable lines. */
async function compareOnline(): Promise<string[]> {
  const tarball = await fetchLuaTarball();
  const local = extract(readTarballMember(tarball, MEMBER).toString('latin1'));
  const response = await fetch(ONLINE_URL);
  if (!response.ok) {
    throw new Error(`GET ${ONLINE_URL} failed: HTTP ${response.status} ${response.statusText}`);
  }
  // Served as text/html without a charset; the page declares iso-8859-1 like the tarball's copy.
  const online = extract(Buffer.from(await response.arrayBuffer()).toString('latin1'));
  const differences: string[] = [];
  for (const key of ['sections', 'entries'] as const) {
    const a = JSON.stringify(local[key], null, 2).split('\n');
    const b = JSON.stringify(online[key], null, 2).split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) differences.push(`${key}, line ${i + 1}:\n  tarball: ${a[i] ?? '(none)'}\n  online:  ${b[i] ?? '(none)'}`);
    }
  }
  if (local.title !== online.title) differences.push(`title: tarball "${local.title}", online "${online.title}"`);
  if (local.copyright !== online.copyright) differences.push(`copyright: tarball "${local.copyright}", online "${online.copyright}"`);
  return differences;
}

async function main(): Promise<void> {
  try {
    if (process.argv.includes('--compare-online')) {
      const differences = await compareOnline();
      if (differences.length === 0) {
        console.log(`The library entries of ${ONLINE_URL} are identical to those of ${MEMBER}.`);
      } else {
        console.log(`${ONLINE_URL} differs from ${MEMBER}:\n${differences.join('\n')}`);
      }
      return;
    }
    const fresh = await generate();
    if (process.argv.includes('--check')) {
      if (!existsSync(output)) {
        fail(`${relative(root, output)} is missing. Run \`npm run lua-manual\` and commit the result.`, output);
      }
      if (readFileSync(output, 'utf8') !== fresh) {
        fail(`${relative(root, output)} does not match the data generated from ${LUA_URL}. Run \`npm run lua-manual\` and commit the result.`, output);
      }
      console.log(`${relative(root, output)} matches the data generated from ${LUA_URL}.`);
      return;
    }
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, fresh);
    console.log(`Wrote ${relative(root, output)}.`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

// Run only as a script, not when the tests import `extract`.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
