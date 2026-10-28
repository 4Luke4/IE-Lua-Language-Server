import assert from 'node:assert/strict';
import { formatSize, installedSize, installSizeBadge, zipEntries } from '../../../../scripts/release/vsix.mts';

interface TestFile {
  readonly name: string;
  readonly content: string;
  readonly utf8?: boolean;
}

/** A ZIP archive of stored (uncompressed) files, built per PKWARE APPNOTE.TXT. CRCs are left 0: the reader does not check them. */
function buildZip(files: readonly TestFile[], comment = ''): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = file.utf8 ? encoder.encode(file.name) : Uint8Array.from(file.name, (c) => c.charCodeAt(0));
    const data = encoder.encode(file.content);
    const flags = file.utf8 ? 0x0800 : 0;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(6, flags, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    locals.push(new Uint8Array(local.buffer), name, data);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(8, flags, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const directorySize = centrals.reduce((total, part) => total + part.length, 0);
  const commentBytes = encoder.encode(comment);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, commentBytes.length, true);
  return concat([...locals, ...centrals, new Uint8Array(end.buffer), commentBytes]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** The layout `vsce package` produces. */
const VSIX: TestFile[] = [
  { name: 'extension.vsixmanifest', content: '<PackageManifest/>' },
  { name: '[Content_Types].xml', content: '<Types/>' },
  { name: 'extension/', content: '' },
  { name: 'extension/package.json', content: '{"name":"x"}' },
  { name: 'extension/dist/server/server.js', content: 'console.log(1);' },
];

describe('scripts/release/vsix', () => {
  describe('zipEntries', () => {
    it('reads the name and uncompressed size of every entry, in order', () => {
      assert.deepEqual(
        zipEntries(buildZip(VSIX)),
        VSIX.map(({ name, content }) => ({ name, uncompressedSize: content.length })),
      );
    });

    it('decodes UTF-8 names when the archive says so', () => {
      assert.deepEqual(zipEntries(buildZip([{ name: 'extension/né.md', content: 'x', utf8: true }])), [{ name: 'extension/né.md', uncompressedSize: 1 }]);
    });

    it('finds the end record behind an archive comment', () => {
      assert.equal(zipEntries(buildZip(VSIX, 'comment with PK\x05\x06 inside')).length, VSIX.length);
    });

    it('rejects data that is not a ZIP archive', () => {
      assert.throws(() => zipEntries(new TextEncoder().encode('not a zip archive, just text')), /no end of central directory/);
      assert.throws(() => zipEntries(new Uint8Array(0)), /no end of central directory/);
    });

    it('rejects ZIP64 archives and truncated central directories', () => {
      const zip = buildZip(VSIX);
      const locator = new DataView(new ArrayBuffer(20));
      locator.setUint32(0, 0x07064b50, true);
      const end = zip.subarray(zip.length - 22);
      const withLocator = concat([zip.subarray(0, zip.length - 22), new Uint8Array(locator.buffer), end]);
      // Keep the central directory offset valid: it is before the inserted locator.
      assert.throws(() => zipEntries(withLocator), /ZIP64/);

      const truncated = buildZip(VSIX);
      new DataView(truncated.buffer).setUint16(truncated.length - 22 + 10, VSIX.length + 1, true);
      assert.throws(() => zipEntries(truncated), /entry 6 of 6 is missing/);
    });
  });

  describe('installedSize', () => {
    it('counts the files VS Code extracts: names starting with "extension", the manifest included', () => {
      const sizes = Object.fromEntries(VSIX.map(({ name, content }) => [name, content.length]));
      const expected = (sizes['extension.vsixmanifest'] ?? 0) + (sizes['extension/package.json'] ?? 0) + (sizes['extension/dist/server/server.js'] ?? 0);
      assert.equal(installedSize(zipEntries(buildZip(VSIX))), expected);
    });

    it('is 0 for an archive without extension files', () => {
      assert.equal(installedSize([{ name: '[Content_Types].xml', uncompressedSize: 9 }]), 0);
    });
  });

  describe('formatSize', () => {
    it('formats like VS Code\'s ByteSize.formatSize, in units of 1024', () => {
      const cases: [number, string][] = [
        [0, '0B'],
        [1023, '1023B'],
        [1024, '1.00KB'],
        [955_479, '933.08KB'],
        [1024 ** 2 - 1, '1024.00KB'],
        [1024 ** 2, '1.00MB'],
        [5.5 * 1024 ** 3, '5.50GB'],
        [2 * 1024 ** 4, '2.00TB'],
        [3 * 1024 ** 5, '3072.00TB'],
      ];
      for (const [size, text] of cases) {
        assert.equal(formatSize(size), text, String(size));
      }
    });
  });

  it('builds a shields.io endpoint badge', () => {
    assert.deepEqual(installSizeBadge(955_479), { schemaVersion: 1, label: 'install size', message: '933.08KB', color: 'informational' });
  });
});
