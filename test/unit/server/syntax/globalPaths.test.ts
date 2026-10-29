import assert from 'node:assert/strict';
import { parseDocument } from '../../../../src/server/syntax/document.ts';
import { fieldWrites, globalPath, withoutG } from '../../../../src/server/syntax/globalPaths.ts';

/** The global path of the value of the last statement `return <expression>` of `text`. */
function pathOfReturn(text: string): string[] | undefined {
  const document = parseDocument(text, 'lua');
  const last = document.chunks[0]?.tree.body.body.at(-1);
  assert.ok(last?.kind === 'ReturnStatement');
  const [value] = last.values;
  assert.ok(value);
  return globalPath(document, 0, value);
}

describe('server/syntax/globalPaths', () => {
  it('lists the names of a `.` chain that starts at a global', () => {
    assert.deepEqual(pathOfReturn('return string'), ['string']);
    assert.deepEqual(pathOfReturn('return _G.string.format'), ['_G', 'string', 'format']);
  });

  it('gives no path for chains that start at a local, a call, an index or a field of a local _ENV', () => {
    assert.equal(pathOfReturn('local string = {} return string.format'), undefined);
    assert.equal(pathOfReturn('return f().x'), undefined);
    assert.equal(pathOfReturn('return t[1].x'), undefined);
    assert.equal(pathOfReturn('local _ENV = {} return string.format'), undefined);
  });

  it('removes `_G.` prefixes while another name follows', () => {
    assert.deepEqual(withoutG(['_G', '_G', 'string']), ['string']);
    assert.deepEqual(withoutG(['_G']), ['_G']);
  });

  it('collects the fields a document assigns on global tables, in every form and chunk', () => {
    const text = 't.a = 1 _G.t.b = 2 function t.c() end function t:d() end local l = {} l.e = 3 t.f.g = 4';
    assert.deepEqual([...fieldWrites(parseDocument(text, 'lua'))].sort(), ['t.a', 't.b', 't.c', 't.d']);
    const menu = 'menu { name "M" onOpen "u.x = 1" action "function u:y() end" }';
    assert.deepEqual([...fieldWrites(parseDocument(menu, 'menu'))].sort(), ['u.x', 'u.y']);
  });
});
