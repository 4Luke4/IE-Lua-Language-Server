// The `files.exclude` setting as a predicate. Pure: no LSP or `vscode` imports.
//
// Follows how VS Code's explorer applies `files.exclude`
// (`src/vs/workbench/contrib/files/browser/views/explorerViewer.ts`, class
// FilesFilter, and `parseExpressionPattern` in `src/vs/base/common/glob.ts`, at
// tags 1.91.0 and 1.144.0):
//
// - each key is a glob pattern (see glob.ts), matched against the path relative to
//   the workspace folder, with `/` separators;
// - the value `false` disables the pattern; `{ "when": "…" }` excludes a match only
//   if a sibling named by `when` exists, where the first `$(basename)` stands for
//   the file name without its extension; any other value enables the pattern;
// - the children of an excluded folder are excluded too (the caller does not
//   descend into it).

import { posix } from 'node:path';
import { compileGlob } from './glob.ts';

/**
 * `true` when `relativePath` (relative to the workspace folder, `/`-separated) is
 * excluded. `hasSibling(name)` tells whether its folder contains an entry `name`.
 */
export type ExcludeFilter = (relativePath: string, hasSibling: (name: string) => boolean) => boolean;

interface ExcludePattern {
  readonly glob: RegExp;
  /** The sibling clause, if any. */
  readonly when: string | undefined;
}

/** Turns a `files.exclude` value into a filter. Anything that is not an object excludes nothing. */
export function filesExcludeFilter(value: unknown): ExcludeFilter {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return () => false;
  }
  const patterns: ExcludePattern[] = [];
  for (const [pattern, setting] of Object.entries(value)) {
    if (setting === false) continue;
    const glob = compileGlob(pattern);
    if (!glob) continue;
    const when: unknown = typeof setting === 'object' && setting !== null ? (setting as { when?: unknown }).when : undefined;
    patterns.push({ glob, when: typeof when === 'string' ? when : undefined });
  }
  if (patterns.length === 0) {
    return () => false;
  }
  return (relativePath, hasSibling) => {
    for (const { glob, when } of patterns) {
      if (!glob.test(relativePath)) continue;
      if (when === undefined) return true;
      const base = posix.basename(relativePath);
      const name = base.slice(0, base.length - posix.extname(base).length);
      if (hasSibling(when.replace('$(basename)', () => name))) return true;
    }
    return false;
  };
}
