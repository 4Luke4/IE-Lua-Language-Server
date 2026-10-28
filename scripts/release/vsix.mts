// Installed size of a VSIX, computed exactly as VS Code computes and shows it,
// for the README's install-size badge. Pure: reads bytes, no file system access.
//
// VS Code (references at tag 1.143.1, https://github.com/microsoft/vscode/tree/1.143.1):
// - Installing a VSIX extracts it with `extract(zipPath, …, { sourcePath: 'extension' })`
//   (src/vs/platform/extensionManagement/node/extensionManagementService.ts:649).
//   `extract` matches entries with the regular expression `^extension` and strips
//   that prefix (src/vs/base/node/zip.ts:388 and :149). The prefix has no slash,
//   so `extension.vsixmanifest` is installed too, as `.vsixmanifest`. Entries
//   whose names end in `/` only create directories.
// - Right after extracting, `metadata.size = await computeSize(tempLocation, …)`
//   (extensionManagementService.ts:657): the sum of the sizes of all files.
//   VS Code adds `__metadata` to package.json only after that, so it is not counted.
// - The extension editor shows `ByteSize.formatSize(extension.size)`
//   (src/vs/workbench/contrib/extensions/browser/extensionEditor.ts:1186;
//   src/vs/platform/files/common/files.ts:1603), in units of 1024.
//
// Checked against a real install with VS Code 1.143.1: the recorded
// `__metadata.size` equals `installedSize()` of the same VSIX.

export interface ZipEntry {
  /** Name as stored in the archive, `/`-separated; directories end in `/`. */
  readonly name: string;
  readonly uncompressedSize: number;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR = 0x07064b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
/** Fixed part of the end of central directory record; a comment of up to 65,535 bytes may follow. */
const END_RECORD_SIZE = 22;
/** General purpose bit 11: the file name is UTF-8 (APPNOTE.TXT 4.4.4). */
const UTF8_FLAG = 0x0800;

/**
 * The entries of a ZIP archive, read from its central directory
 * (PKWARE APPNOTE.TXT 4.3.12 and 4.3.16). Throws on anything that is not a
 * plain ZIP: a VSIX never needs ZIP64, so its markers are rejected.
 */
export function zipEntries(zip: Uint8Array): ZipEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = -1;
  for (let offset = zip.length - END_RECORD_SIZE; offset >= Math.max(0, zip.length - END_RECORD_SIZE - 0xffff); offset--) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY && offset + END_RECORD_SIZE + view.getUint16(offset + 20, true) === zip.length) {
      end = offset;
      break;
    }
  }
  if (end < 0) {
    throw new Error('Not a ZIP archive: no end of central directory record.');
  }
  if (end >= 20 && view.getUint32(end - 20, true) === ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR) {
    throw new Error('ZIP64 archives are not supported.');
  }
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (directoryOffset + directorySize > end) {
    throw new Error('Corrupt ZIP archive: the central directory overlaps its end record.');
  }
  const entries: ZipEntry[] = [];
  let offset = directoryOffset;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== CENTRAL_DIRECTORY_HEADER) {
      throw new Error(`Corrupt ZIP archive: central directory entry ${String(i + 1)} of ${String(count)} is missing.`);
    }
    const flags = view.getUint16(offset + 8, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (uncompressedSize === 0xffffffff) {
      throw new Error('ZIP64 archives are not supported.');
    }
    const nameBytes = zip.subarray(offset + 46, offset + 46 + nameLength);
    // Without the UTF-8 flag names are CP437; VSIX names are ASCII, which both encodings share.
    const name = new TextDecoder(flags & UTF8_FLAG ? 'utf-8' : 'latin1').decode(nameBytes);
    entries.push({ name, uncompressedSize });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Bytes VS Code installs from a VSIX with these entries (see the file header). */
export function installedSize(entries: readonly ZipEntry[]): number {
  return entries
    .filter(({ name }) => name.startsWith('extension') && !name.endsWith('/'))
    .reduce((total, { uncompressedSize }) => total + uncompressedSize, 0);
}

/** `ByteSize.formatSize` of VS Code with its English messages, e.g. `933.08KB`. */
export function formatSize(size: number): string {
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  if (size < 1024) {
    return `${size.toFixed(0)}B`;
  }
  let unit = 0;
  while (unit < units.length - 1 && size >= 1024 ** (unit + 2)) {
    unit++;
  }
  return `${(size / 1024 ** (unit + 1)).toFixed(2)}${units[unit] ?? ''}`;
}

/** A shields.io endpoint badge (https://shields.io/badges/endpoint-badge), schema version 1. */
export interface EndpointBadge {
  readonly schemaVersion: 1;
  readonly label: string;
  readonly message: string;
  readonly color: string;
}

/** The install-size badge for a VSIX of `size` installed bytes. */
export function installSizeBadge(size: number): EndpointBadge {
  return { schemaVersion: 1, label: 'install size', message: formatSize(size), color: 'informational' };
}
