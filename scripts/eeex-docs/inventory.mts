// Pure helpers for scripts/eeex-docs/sync.mts (unit-tested in test/unit/scripts/eeex-docs/).
import { inflateSync } from 'node:zlib';

export const DOCS_BASE = 'https://eeex-docs.readthedocs.io/en/latest/';
/** Lua-style identifiers, optionally qualified with `:`, `.` or `::` (excludes page titles). */
const IDENTIFIER = /^[A-Za-z_]\w*(?:(?:::|[:.])[A-Za-z_]\w*)*$/;

export interface InventoryItem {
  readonly name: string;
  readonly role: string;
  readonly uri: string;
  readonly display: string;
}

/** Parses a Sphinx inventory v2 file (format: sphinx.util.inventory). */
export function parseInventory(data: Buffer): InventoryItem[] {
  let offset = 0;
  const header: string[] = [];
  for (let i = 0; i < 4; i++) {
    const end = data.indexOf(0x0a, offset);
    header.push(data.subarray(offset, end).toString('utf8'));
    offset = end + 1;
  }
  if (header[0] !== '# Sphinx inventory version 2' || !header[3]?.includes('zlib')) {
    throw new Error(`Unsupported inventory header: ${JSON.stringify(header)}`);
  }
  const line = /^(.+?)\s+(\S+)\s+(-?\d+)\s+?(\S*)\s+(.*)$/;
  return inflateSync(data.subarray(offset))
    .toString('utf8')
    .split('\n')
    .flatMap((text) => {
      const match = line.exec(text);
      if (!match) {
        return [];
      }
      const [, name = '', role = '', , uri = '', display = ''] = match;
      // Sphinx shorthands: `$` at the end of the URI is the name, `-` as display is the name.
      return [{ name, role, uri: uri.endsWith('$') ? uri.slice(0, -1) + name : uri, display: display === '-' ? name : display }];
    });
}

export function sectionEntries(
  inventory: readonly InventoryItem[],
  directory: string,
): { name: string; url: string }[] {
  const prefix = `${encodeURI(directory).replaceAll('(', '%28').replaceAll(')', '%29')}/`;
  const seen = new Set<string>();
  return inventory
    .filter((item) => item.role === 'std:label' && item.uri.startsWith(prefix) && item.uri.includes('#') && IDENTIFIER.test(item.display))
    .map((item) => ({ name: item.display, url: DOCS_BASE + item.uri }))
    .filter((entry) => {
      const key = `${entry.name}\n${entry.url}`;
      return seen.has(key) ? false : (seen.add(key), true);
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.url < b.url ? -1 : 1));
}
