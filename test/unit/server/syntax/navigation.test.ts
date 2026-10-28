import assert from 'node:assert/strict';
import { parseDocument, type ParsedDocument } from '../../../../src/server/syntax/document.ts';
import { definitions, references, targetAt } from '../../../../src/server/syntax/navigation.ts';

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

  describe('references', () => {
    function referencesAt(text: string, needle: string, occurrence: number, includeDeclaration: boolean, kind: 'lua' | 'menu' = 'lua'): string[] {
      const document = parseDocument(text, kind);
      const hit = targetAt(document, offsetOf(text, needle, occurrence));
      assert.ok(hit, `no target at "${needle}" #${String(occurrence)}`);
      return at(references(document, hit.target, includeDeclaration));
    }

    it('lists the uses of a local, with its declaration first when asked', () => {
      //            0         1         2         3
      //            01234567890123456789012345678901234567
      const text = 'local n = 1 n = n + 1 do print(n) end';
      assert.deepEqual(referencesAt(text, 'n', 2, true), ['n@6', 'n@12', 'n@16', 'n@31']);
      assert.deepEqual(referencesAt(text, 'n', 0, false), ['n@12', 'n@16', 'n@31']);
    });

    it('lists a local function before the recursive calls in its body', () => {
      const text = 'local function f(n) return f(n - 1) end';
      assert.deepEqual(referencesAt(text, 'f', 1, true), ['f@15', 'f@27']);
    });

    it('keeps shadowing locals apart', () => {
      const text = 'local x = 1 do local x = 2 print(x) end print(x)';
      assert.deepEqual(referencesAt(text, 'x', 0, true), ['x@6', 'x@46']);
      assert.deepEqual(referencesAt(text, 'x', 1, true), ['x@21', 'x@33']);
    });

    it('lists the uses of the implicit self of a method', () => {
      const text = 'function T:m() self.n = 1 return self end';
      assert.deepEqual(referencesAt(text, 'self', 1, true), ['self@15', 'self@33']);
    });

    it('treats every assignment to a global as a declaration', () => {
      const text = 'g = 1 function g() end print(g)';
      assert.deepEqual(referencesAt(text, 'g', 2, true), ['g@0', 'g@15', 'g@29']);
      assert.deepEqual(referencesAt(text, 'g', 2, false), ['g@29']);
    });

    it('finds globals in every Lua chunk of a .menu file, locals only in their own', () => {
      const text = "`\nflag = 1\nlocal own = flag\n`\nmenu\n{\n\tname 'M'\n\tenabled \"flag == own\"\n}\n";
      assert.deepEqual(referencesAt(text, 'flag', 2, true, 'menu'), ['flag@2', 'flag@23', `flag@${String(offsetOf(text, 'flag', 2))}`]);
      assert.deepEqual(referencesAt(text, 'own', 0, true, 'menu'), ['own@17']);
    });
  });
});
