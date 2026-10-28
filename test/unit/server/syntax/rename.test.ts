import assert from 'node:assert/strict';
import type { RenameRefusal } from '../../../../src/shared/protocol.ts';
import { parseDocument } from '../../../../src/server/syntax/document.ts';
import { prepareRename, rename } from '../../../../src/server/syntax/rename.ts';

/** Offset of the `occurrence`-th (0-based) whole-word `needle` in `text`. */
function offsetOf(text: string, needle: string, occurrence = 0): number {
  const match = [...text.matchAll(new RegExp(`\\b${needle}\\b`, 'g'))][occurrence];
  assert.ok(match, `"${needle}" #${String(occurrence)} not found`);
  return match.index;
}

/** The renamed text, or the refusal. */
function renamed(text: string, needle: string, occurrence: number, newName: string, kind: 'lua' | 'menu' = 'lua'): string | { refusal: RenameRefusal } {
  const result = rename(parseDocument(text, kind), text, offsetOf(text, needle, occurrence), newName);
  if (!result.ok) {
    return { refusal: result.refusal };
  }
  let output = text;
  for (const edit of [...result.value].reverse()) {
    output = output.slice(0, edit.start) + edit.newText + output.slice(edit.end);
  }
  return output;
}

describe('server/syntax/rename', () => {
  describe('prepareRename', () => {
    const text = 'local t = {} function t:m() return self end t.x = print(g) g = 1';
    const document = parseDocument(text, 'lua');
    const prepare = (needle: string, occurrence = 0) => prepareRename(document, offsetOf(text, needle, occurrence));

    it('accepts locals and globals the document assigns, returning the name under the cursor', () => {
      for (const [needle, occurrence] of [['t', 0], ['t', 1], ['g', 0], ['g', 1]] as const) {
        const result = prepare(needle, occurrence);
        assert.ok(result.ok, `${needle} #${String(occurrence)}`);
        assert.equal(result.value.start, offsetOf(text, needle, occurrence));
        assert.equal(result.value.name, needle);
      }
    });

    it('refuses keywords, field and method names', () => {
      for (const needle of ['local', 'function', 'x', 'm']) {
        assert.deepEqual(prepare(needle), { ok: false, refusal: 'notAVariable' }, needle);
      }
    });

    it('refuses the implicit self and globals the document never assigns', () => {
      assert.deepEqual(prepare('self'), { ok: false, refusal: 'implicitSelf' });
      assert.deepEqual(prepare('print'), { ok: false, refusal: 'globalNotDefinedHere' });
    });
  });

  describe('rename', () => {
    it('renames the declaration and every use of a local, and nothing else', () => {
      const text = 'local n = 1 n = n + 1 local t = { n = n } print(t.n, n)';
      assert.equal(renamed(text, 'n', 0, 'count'), 'local count = 1 count = count + 1 local t = { n = count } print(t.n, count)');
    });

    it('renames only the local the cursor is on when names are shadowed', () => {
      const text = 'local x = 1 do local x = 2 print(x) end print(x)';
      assert.equal(renamed(text, 'x', 1, 'inner'), 'local x = 1 do local inner = 2 print(inner) end print(x)');
    });

    it('renames a global everywhere in a .menu file, across its Lua chunks', () => {
      const text = "`\nflag = 1\n`\nmenu\n{\n\tname 'flag'\n\tenabled \"flag\"\n}\n";
      assert.equal(renamed(text, 'flag', 0, 'ready', 'menu'), "`\nready = 1\n`\nmenu\n{\n\tname 'flag'\n\tenabled \"ready\"\n}\n");
    });

    it('returns no edits for the same name', () => {
      const text = 'local a = 1';
      const result = rename(parseDocument(text, 'lua'), text, 6, 'a');
      assert.deepEqual(result, { ok: true, value: [] });
    });

    it('refuses when the code the variable can occur in has syntax errors, as uses may be missing', () => {
      // Error recovery drops the unfinished call, and with it this use of `a`.
      assert.deepEqual(renamed('local a = 1 print(a', 'a', 0, 'b'), { refusal: 'syntaxErrors' });
      const menu = "`\nlocal own = 1 g = own\n`\nmenu\n{\n\tname 'M'\n\tenabled \"g ==\"\n}\n";
      assert.deepEqual(renamed(menu, 'g', 0, 'h', 'menu'), { refusal: 'syntaxErrors' });
      assert.equal(renamed(menu, 'own', 0, 'mine', 'menu'), menu.replaceAll('own', 'mine'));
    });

    it('refuses names that are not Lua names, and reserved words', () => {
      for (const name of ['', '1a', 'a-b', 'a b', ' a', 'a.b', 'é', '--a', '"a"']) {
        assert.deepEqual(renamed('local a', 'a', 0, name), { refusal: 'invalidName' }, JSON.stringify(name));
      }
      for (const name of ['end', 'nil', 'goto', 'and']) {
        assert.deepEqual(renamed('local a', 'a', 0, name), { refusal: 'reservedWord' }, name);
      }
      assert.equal(renamed('local a', 'a', 0, '_Name2'), 'local _Name2');
    });

    it('refuses to let an inner local capture a renamed use', () => {
      assert.deepEqual(renamed('local a = 1 do local b = 2 print(a) end', 'a', 1, 'b'), { refusal: 'conflict' });
    });

    it('refuses to hide an outer local or a global used in the renamed local\'s scope', () => {
      assert.deepEqual(renamed('local b = 1 do local a = 2 print(b, a) end', 'a', 1, 'b'), { refusal: 'conflict' });
      assert.deepEqual(renamed('local a = 1 print(a, g)', 'a', 1, 'g'), { refusal: 'conflict' });
    });

    it('allows a name used elsewhere when no reference changes', () => {
      const text = 'do local a = 1 print(a) end print(b) local b = 2';
      assert.equal(renamed(text, 'a', 1, 'b'), 'do local b = 1 print(b) end print(b) local b = 2');
    });

    it('refuses to merge two globals or to let a local capture a renamed global', () => {
      assert.deepEqual(renamed('x = 1 y = 2', 'x', 0, 'y'), { refusal: 'conflict' });
      assert.deepEqual(renamed('g = 1 local h = 2 print(g)', 'g', 0, 'h'), { refusal: 'conflict' });
    });

    it('refuses the same targets as prepareRename', () => {
      assert.deepEqual(renamed('print(1)', 'print', 0, 'p'), { refusal: 'globalNotDefinedHere' });
      assert.deepEqual(renamed('local t = {} t.x = 1', 'x', 0, 'y'), { refusal: 'notAVariable' });
    });
  });
});
