import assert from 'node:assert/strict';
import { FoldingRangeKind } from 'vscode-languageserver/node';
import { toLspFoldingRanges } from '../../../../src/server/features/foldingRanges.ts';
import type { Fold } from '../../../../src/server/syntax/folding.ts';

const folds: Fold[] = [
  { startLine: 0, endLine: 2, kind: 'comment' },
  { startLine: 3, endLine: 5, kind: undefined },
  { startLine: 6, endLine: 9, kind: undefined },
];

describe('server/features/foldingRanges toLspFoldingRanges', () => {
  it('returns whole-line ranges with the comment kind when the client accepts any kind', () => {
    assert.deepEqual(toLspFoldingRanges(folds, { rangeLimit: undefined, kinds: undefined }), [
      { startLine: 0, endLine: 2, kind: FoldingRangeKind.Comment },
      { startLine: 3, endLine: 5 },
      { startLine: 6, endLine: 9 },
    ]);
  });

  it('omits the comment kind when the client does not list it', () => {
    const [first] = toLspFoldingRanges(folds, { rangeLimit: undefined, kinds: [FoldingRangeKind.Region] });
    assert.deepEqual(first, { startLine: 0, endLine: 2 });
  });

  it('keeps only the first rangeLimit ranges', () => {
    assert.deepEqual(toLspFoldingRanges(folds, { rangeLimit: 2, kinds: undefined }).map((r) => r.startLine), [0, 3]);
    assert.deepEqual(toLspFoldingRanges(folds, { rangeLimit: 0, kinds: undefined }), []);
  });
});
