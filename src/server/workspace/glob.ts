// Glob patterns as VS Code matches `files.exclude`. Pure: no LSP or `vscode` imports.
//
// The semantics follow VS Code's `src/vs/base/common/glob.ts` (function
// `parseRegExp`, identical at tags 1.91.0 and 1.144.0), which also implements the
// syntax of LSP 3.17's `GlobPattern`:
//
// - the pattern is split into segments at `/` (not inside `{…}` or `[…]`);
// - a `**` segment matches any number of path segments, including none;
// - `*` matches any run of characters except a path separator, `?` exactly one;
// - `{a,b}` matches either choice; each choice is itself a pattern, and braces do not nest;
// - `[…]` matches one character of a set, `-` gives a range, `!` or `^` first negates,
//   `]` first is literal and `/` is dropped;
// - `/` and `\` both separate path segments in the matched path;
// - an unterminated `{` or `[` drops the rest of its segment; a stray `}` is dropped
//   and a stray `]` makes the pattern match nothing;
// - matching is case-sensitive (the explorer parses `files.exclude` without `ignoreCase`).

const SEPARATOR = '[/\\\\]';
const NOT_SEPARATOR = '[^/\\\\]';

/** Escapes what VS Code's `escapeRegExpCharacters` escapes. */
function escape(text: string): string {
  return text.replace(/[\\{}*+?|^$.[\]()]/g, '\\$&');
}

/** Splits at `separator` except inside `{…}` and `[…]` (which do not nest). */
function split(pattern: string, separator: string): string[] {
  const parts: string[] = [];
  let inBraces = false;
  let inBrackets = false;
  let current = '';
  for (const c of pattern) {
    if (c === separator && !inBraces && !inBrackets) {
      parts.push(current);
      current = '';
      continue;
    }
    if (c === '{') inBraces = true;
    else if (c === '}') inBraces = false;
    else if (c === '[') inBrackets = true;
    else if (c === ']') inBrackets = false;
    current += c;
  }
  if (current !== '') parts.push(current);
  return parts;
}

/** `**`: any number of whole segments; as the last segment also `/<segment>`. */
function globstar(last: boolean): string {
  return `(?:${SEPARATOR}|${NOT_SEPARATOR}+${SEPARATOR}${last ? `|${SEPARATOR}${NOT_SEPARATOR}+` : ''})*?`;
}

/** One segment without `/` (except inside braces, whose choices are whole patterns). */
function segmentSource(segment: string): string {
  let source = '';
  let braces: string | undefined;
  let brackets: string | undefined;
  for (const c of segment) {
    if (braces !== undefined) {
      if (c === '}') {
        source += `(?:${split(braces, ',').map(patternSource).join('|')})`;
        braces = undefined;
      } else {
        braces += c;
      }
    } else if (brackets !== undefined) {
      if (c === ']' && brackets !== '') {
        source += `[${brackets}]`;
        brackets = undefined;
      } else if (c === '-') {
        brackets += c;
      } else if ((c === '!' || c === '^') && brackets === '') {
        brackets = '^';
      } else if (c !== '/') {
        brackets += escape(c);
      }
    } else if (c === '{') {
      braces = '';
    } else if (c === '[') {
      brackets = '';
    } else if (c === '}') {
      // A `}` outside braces closes an empty choice list: it matches the empty string.
      source += '(?:)';
    } else if (c === ']') {
      // A `]` outside brackets closes an empty set, which matches nothing.
      source += '[]';
    } else if (c === '?') {
      source += NOT_SEPARATOR;
    } else if (c === '*') {
      source += `${NOT_SEPARATOR}*?`;
    } else {
      source += escape(c);
    }
  }
  return source;
}

function patternSource(pattern: string): string {
  const segments = split(pattern, '/');
  if (segments.length > 0 && segments.every((segment) => segment === '**')) {
    return '.*';
  }
  let source = '';
  segments.forEach((segment, index) => {
    if (segment === '**') {
      // Consecutive globstars act as one.
      if (segments[index - 1] !== '**') source += globstar(index === segments.length - 1);
      return;
    }
    source += segmentSource(segment);
    // A separator follows unless the rest of the pattern is a single trailing `**`.
    const next = segments[index + 1];
    if (next !== undefined && (next !== '**' || index + 2 < segments.length)) {
      source += SEPARATOR;
    }
  });
  return source;
}

/**
 * Compiles a glob pattern. Returns `undefined` for a pattern that matches
 * nothing: empty after trimming, or not a valid regular expression once
 * translated (VS Code treats both the same way).
 */
export function compileGlob(pattern: string): RegExp | undefined {
  const trimmed = pattern.trim();
  if (trimmed === '') return undefined;
  try {
    return new RegExp(`^${patternSource(trimmed)}$`);
  } catch {
    return undefined;
  }
}
