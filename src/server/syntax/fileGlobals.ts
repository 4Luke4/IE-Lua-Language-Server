// A compact record of where a file names each global shared with other files
// (see `globalOccurrences` in navigation.ts), kept by the workspace index for
// every file for as long as the server runs. Offsets are stored in typed arrays
// and turned into line/character positions only for the uses a request returns.
// Pure: no LSP or `vscode` imports.

import type { ParsedDocument } from './document.ts';
import { globalOccurrences } from './navigation.ts';

/** A zero-based line and UTF-16 character, as LSP positions count them. */
export interface LineCharacter {
  readonly line: number;
  readonly character: number;
}

export interface FileGlobals {
  /** The offset where each line starts (the first is 0). */
  readonly lineStarts: Uint32Array;
  /** The slot of each global name the file uses. */
  readonly slots: ReadonlyMap<string, number>;
  /** Slot `s` owns the triples from `bounds[s]` to `bounds[s + 1]` (exclusive), counted in triples. */
  readonly bounds: Uint32Array;
  /** `start, end, isWrite (0 or 1)` triples, by slot, each slot's in document order. */
  readonly uses: Uint32Array;
}

/** Fields per use in `FileGlobals.uses`. */
const FIELDS = 3;

/**
 * The offset where each line of `text` starts. A line ends at `\n`, `\r\n` or a
 * lone `\r`, as in vscode-languageserver-textdocument, so positions match the
 * ones `TextDocument.positionAt` gives for the same text.
 */
export function lineStarts(text: string): Uint32Array {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x0d || code === 0x0a) {
      if (code === 0x0d && text.charCodeAt(i + 1) === 0x0a) i++;
      starts.push(i + 1);
    }
  }
  return Uint32Array.from(starts);
}

/** The position of `offset`, by binary search in `starts` (see `lineStarts`). */
export function positionAt(starts: Uint32Array, offset: number): LineCharacter {
  // The last line starting at or before `offset`; `starts[0]` is 0, so there is one.
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((starts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low, character: offset - (starts[low] ?? 0) };
}

/**
 * The shared globals of a parsed document, compactly: three typed arrays and
 * one map per file, whatever the number of names, as typed arrays have a fixed
 * cost of their own each.
 */
export function fileGlobals(document: ParsedDocument): FileGlobals {
  const occurrences = globalOccurrences(document);
  const slots = new Map<string, number>();
  const bounds = new Uint32Array(occurrences.size + 1);
  let total = 0;
  for (const list of occurrences.values()) total += list.length;
  const uses = new Uint32Array(total * FIELDS);
  let next = 0;
  for (const [name, list] of occurrences) {
    const slot = slots.size;
    slots.set(name, slot);
    bounds[slot] = next;
    for (const { start, end, isWrite } of list) {
      uses[next * FIELDS] = start;
      uses[next * FIELDS + 1] = end;
      uses[next * FIELDS + 2] = isWrite ? 1 : 0;
      next++;
    }
  }
  bounds[slots.size] = next;
  return { lineStarts: lineStarts(document.text), slots, bounds, uses };
}

/** Whether the file uses the global `name`. */
export function usesGlobal(globals: FileGlobals, name: string): boolean {
  return globals.slots.has(name);
}

/** The ranges of the uses of `name` that `keep` accepts (by whether they assign it), in document order. */
export function globalRanges(globals: FileGlobals, name: string, keep: (isWrite: boolean) => boolean): { start: LineCharacter; end: LineCharacter }[] {
  const ranges: { start: LineCharacter; end: LineCharacter }[] = [];
  const slot = globals.slots.get(name);
  if (slot === undefined) return ranges;
  const { uses, lineStarts: starts } = globals;
  const from = globals.bounds[slot] ?? 0;
  const to = globals.bounds[slot + 1] ?? from;
  for (let use = from; use < to; use++) {
    // In bounds: `bounds` never exceeds the number of triples in `uses`.
    const start = uses[use * FIELDS] ?? 0;
    const end = uses[use * FIELDS + 1] ?? 0;
    if (keep(uses[use * FIELDS + 2] === 1)) ranges.push({ start: positionAt(starts, start), end: positionAt(starts, end) });
  }
  return ranges;
}
