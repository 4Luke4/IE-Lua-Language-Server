// Verifies the localization files (`npm run check-l10n`). Exits non-zero with
// one GitHub annotation per problem, naming the file and key at fault.
//
// Checks:
//  1. Every VS Code display language has package.nls.<locale>.json and
//     l10n/bundle.l10n.<locale>.json.
//  2. Each locale has exactly the keys of the English source, all non-empty.
//  3. Code spans (`…`, which include setting links), {0}-style placeholders and
//     **IE Lua: <command title>** references survive translation unchanged
//     (references must use that locale's own command title).
//  4. Every %key% used in package.json exists in package.nls.json and vice versa.
//  5. l10n/bundle.l10n.json equals a fresh `@vscode/l10n-dev export` of src/client.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The display languages VS Code offers as language packs, besides English:
// https://code.visualstudio.com/docs/configure/locales#_available-locales
export const LOCALES = ['cs', 'de', 'es', 'fr', 'hu', 'it', 'ja', 'ko', 'pl', 'pt-br', 'ru', 'tr', 'zh-cn', 'zh-tw'] as const;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors: string[] = [];

function error(file: string, message: string): void {
  errors.push(`::error file=${relative(root, file)},title=Localization::${message}`);
}

function readJson(file: string): Record<string, string> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      error(file, 'must contain a JSON object of strings.');
      return undefined;
    }
    return value as Record<string, string>;
  } catch (cause) {
    error(file, `cannot be read or parsed: ${cause instanceof Error ? cause.message : String(cause)}`);
    return undefined;
  }
}

/** Fragments that must appear unchanged in every translation. */
function invariants(text: string): string[] {
  return [...(text.match(/`[^`]*`/g) ?? []), ...(text.match(/\{\d+\}/g) ?? [])].sort();
}

function commandReferences(text: string): string[] {
  return [...text.matchAll(/\*\*IE Lua: ([^*]+)\*\*/g)].map((match) => match[1] ?? '');
}

function compare(
  source: Record<string, string>,
  sourceFile: string,
  target: Record<string, string>,
  targetFile: string,
  commandTitle?: string,
): void {
  for (const key of Object.keys(source)) {
    const translated = target[key];
    if (typeof translated !== 'string' || translated.trim() === '') {
      error(targetFile, `missing or empty translation for "${key}" (see ${relative(root, sourceFile)}).`);
      continue;
    }
    const expected = invariants(source[key] ?? '');
    const actual = invariants(translated);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      error(targetFile, `"${key}" must keep ${JSON.stringify(expected)} unchanged, found ${JSON.stringify(actual)}.`);
    }
    if (commandTitle !== undefined) {
      const references = commandReferences(translated);
      if (references.length !== commandReferences(source[key] ?? '').length || references.some((title) => title !== commandTitle)) {
        error(targetFile, `"${key}" must refer to the command as **IE Lua: ${commandTitle}** (this locale's title).`);
      }
    }
  }
  for (const key of Object.keys(target)) {
    if (!(key in source)) {
      error(targetFile, `unknown key "${key}"; it does not exist in ${relative(root, sourceFile)}.`);
    }
  }
}

const packageNlsFile = join(root, 'package.nls.json');
const bundleFile = join(root, 'l10n', 'bundle.l10n.json');
const packageNls = readJson(packageNlsFile);
const bundle = readJson(bundleFile);

if (packageNls && bundle) {
  for (const locale of LOCALES) {
    const nlsFile = join(root, `package.nls.${locale}.json`);
    const nls = readJson(nlsFile);
    if (nls) {
      compare(packageNls, packageNlsFile, nls, nlsFile, nls['command.validateDocument.title']);
    }
    const localeBundleFile = join(root, 'l10n', `bundle.l10n.${locale}.json`);
    const localeBundle = readJson(localeBundleFile);
    if (localeBundle) {
      compare(bundle, bundleFile, localeBundle, localeBundleFile);
    }
  }

  // 4. package.json %key% references.
  const manifestFile = join(root, 'package.json');
  const used = new Set([...readFileSync(manifestFile, 'utf8').matchAll(/"%([^%"]+)%"/g)].map((match) => match[1] ?? ''));
  for (const key of used) {
    if (!(key in packageNls)) {
      error(manifestFile, `"%${key}%" has no entry in package.nls.json.`);
    }
  }
  for (const key of Object.keys(packageNls)) {
    if (!used.has(key)) {
      error(packageNlsFile, `"${key}" is not used by package.json; remove it from every package.nls*.json.`);
    }
  }

  // 5. The English runtime bundle must match the vscode.l10n.t() calls in the client.
  const scratch = mkdtempSync(join(tmpdir(), 'l10n-'));
  try {
    execFileSync(process.execPath, [join(root, 'node_modules', '@vscode', 'l10n-dev', 'dist', 'cli.js'), 'export', '--outDir', scratch, join(root, 'src', 'client')], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const fresh = readJson(join(scratch, 'bundle.l10n.json'));
    if (fresh && JSON.stringify(fresh) !== JSON.stringify(bundle)) {
      error(bundleFile, 'is out of date with the vscode.l10n.t() calls in src/client. Run `npx @vscode/l10n-dev export --outDir l10n src/client`, then update every bundle.l10n.<locale>.json.');
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (errors.length > 0) {
  for (const line of errors) {
    console.error(line);
  }
  console.error(`Localization check failed with ${errors.length} problem(s).`);
  process.exit(1);
}
console.log(`Localization check passed: ${LOCALES.length} locales, ${Object.keys(packageNls ?? {}).length} manifest strings, ${Object.keys(bundle ?? {}).length} runtime strings.`);
