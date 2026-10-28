import assert from 'node:assert/strict';
import { parseDocument, type ParsedDocument } from '../../../../src/server/syntax/document.ts';
import { definitions, targetAt } from '../../../../src/server/syntax/navigation.ts';

/** `name@offset` for each identifier. */
const at = (identifiers: readonly { name: string; start: number }[]): string[] => identifiers.map((i) => `${i.name}@${String(i.start)}`);

/** Offset of the `occurrence`-th (0-based) `needle` in `text`. */
function offsetOf(text: string, needle: string, occurrence = 0): number {
  let offset = -1;
  for (let i = 0; i <= occurrence; i++) {
    offset = text.indexOf(needle, offset + 1);
    assert.ok(offset >= 0, `"${needle}" #${String(i)} not found`);
  }
  return offset;
}

function definitionsAt(document: ParsedDocument, offset: number): string[] | undefined {
  const hit = targetAt(document, offset);
  return hit && at(definitions(document, hit.target));
}

describe('server/syntax/navigation', () => {
  describe('targetAt', () => {
    //            0         1         2
    //            0123456789012345678901234
    const text = 'local t = {} t.x = t:m()';
    const document = parseDocument(text, 'lua');

    it('finds the variable under the cursor, also just after its last character', () => {
      for (const offset of [6, 7]) {
        const hit = targetAt(document, offset);
        assert.equal(hit?.target.kind, 'local');
        assert.equal(hit.identifier.start, 6);
      }
      assert.deepEqual(targetAt(document, 13)?.identifier.start, 13);
    });

    it('ignores keywords, field and method names, and space between tokens', () => {
      for (const offset of [0, 3, 9, 15, 21]) {
        assert.equal(targetAt(document, offset), undefined, `offset ${String(offset)}`);
      }
    });

    it('classifies names without a visible local as globals', () => {
      const hit = targetAt(parseDocument('print(x)', 'lua'), 6);
      assert.deepEqual(hit?.target, { kind: 'global', name: 'x' });
    });

    it('returns nothing for an empty document', () => {
      assert.equal(targetAt(parseDocument('', 'lua'), 0), undefined);
    });
  });

  describe('definitions', () => {
    it('goes from any use of a local to its declaration', () => {
      const text = 'local count = 0\ncount = count + 1\nprint(count)';
      const document = parseDocument(text, 'lua');
      for (const occurrence of [0, 1, 2, 3]) {
        assert.deepEqual(definitionsAt(document, offsetOf(text, 'count', occurrence)), ['count@6']);
      }
    });

    it('resolves shadowed names to the innermost declaration', () => {
      const text = 'local x = 1\ndo local x = 2 print(x) end\nprint(x)';
      const document = parseDocument(text, 'lua');
      assert.deepEqual(definitionsAt(document, offsetOf(text, 'x', 2)), ['x@21']);
      assert.deepEqual(definitionsAt(document, offsetOf(text, 'x', 3)), ['x@6']);
    });

    it('lists every assignment to a global, including `function g()`', () => {
      const text = 'function g() end\nif ready then g = nil end\ng()';
      const document = parseDocument(text, 'lua');
      assert.deepEqual(definitionsAt(document, offsetOf(text, 'g', 2)), ['g@9', 'g@31']);
    });

    it('returns no definition for globals the document never assigns, nor for the implicit self', () => {
      const text = 'function T:m() return self end\nprint(T)';
      const document = parseDocument(text, 'lua');
      assert.deepEqual(definitionsAt(document, offsetOf(text, 'print')), []);
      assert.deepEqual(definitionsAt(document, offsetOf(text, 'T', 1)), []);
      assert.deepEqual(definitionsAt(document, offsetOf(text, 'self')), []);
    });

    it('shares globals between the Lua chunks of a .menu file, but not locals', () => {
      const text = "`\nshown = false\nlocal hidden = 1\n`\nmenu\n{\n\tname 'M'\n\tonOpen \"shown = true print(hidden)\"\n}\n";
      const document = parseDocument(text, 'menu');
      assert.equal(document.chunks.length, 2);
      assert.deepEqual(definitionsAt(document, offsetOf(text, 'shown', 1)), ['shown@2', `shown@${String(offsetOf(text, 'shown', 1))}`]);
      assert.deepEqual(definitionsAt(document, offsetOf(text, 'hidden', 1)), []);
    });
  });
});
