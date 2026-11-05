import assert from 'node:assert/strict';
import { docCommentFor, documentDocs, parameterDoc } from '../../../../src/server/docComments/attach.ts';
import { parseDocument, type ParsedDocument } from '../../../../src/server/syntax/document.ts';
import { targetAt } from '../../../../src/server/syntax/navigation.ts';

/** The description of the doc comment of the declaring or assigned name at the first `needle`. */
function descriptionAt(document: ParsedDocument, needle: string): string | undefined {
  const hit = targetAt(document, document.text.indexOf(needle));
  assert.ok(hit, needle);
  return docCommentFor(document, hit.identifier)?.description;
}

const lua = (...source: string[]): ParsedDocument => parseDocument(source.join('\n'), 'lua');

describe('server/docComments/attach', () => {
  it('documents the statement on the next line, with any indentation', () => {
    const document = lua('--- Adds.', 'local function add(a, b) end', '  --- Value.', '  local value = 1', '--- Global.', 'function G() end', '--- Assigned.', 'H = 2');
    assert.equal(descriptionAt(document, 'add'), 'Adds.');
    assert.equal(descriptionAt(document, 'value'), 'Value.');
    assert.equal(descriptionAt(document, 'G('), 'Global.');
    assert.equal(descriptionAt(document, 'H ='), 'Assigned.');
  });

  it('joins doc lines on consecutive lines into one block', () => {
    const document = lua('--- One.', '--- Two.', 'local x');
    assert.equal(descriptionAt(document, 'x'), 'One.\nTwo.');
    assert.equal(documentDocs(document).blocks.length, 1);
  });

  it('accepts \\r\\n and \\r line breaks', () => {
    assert.equal(descriptionAt(parseDocument('--- A.\r\n--- B.\r\nlocal x', 'lua'), 'x'), 'A.\nB.');
    assert.equal(descriptionAt(parseDocument('--- A.\rlocal x', 'lua'), 'x'), 'A.');
  });

  it('is detached by a blank line', () => {
    assert.equal(descriptionAt(lua('--- Header.', '', 'local x'), 'x'), undefined);
    const split = lua('--- A.', '', '--- B.', 'local x');
    assert.equal(descriptionAt(split, 'x'), 'B.');
    assert.equal(documentDocs(split).blocks.length, 2);
  });

  it('ignores -- and ---- comments, long comments, and --- after code', () => {
    assert.equal(descriptionAt(lua('-- Plain.', 'local x'), 'x'), undefined);
    assert.equal(descriptionAt(lua('---- Banner', 'local x'), 'x'), undefined);
    assert.equal(descriptionAt(lua('--[[ Long. ]]', 'local x'), 'x'), undefined);
    const trailing = lua('local y = 1 --- Not a doc.', 'local x');
    assert.equal(descriptionAt(trailing, 'x'), undefined);
    assert.equal(documentDocs(trailing).blocks.length, 0);
  });

  it('does not document a statement that starts later on the next line', () => {
    assert.equal(descriptionAt(lua('--- A.', 'local y = 1 local x = 2'), 'x ='), undefined);
    assert.equal(descriptionAt(lua('--- A.', 'local y = 1 local x = 2'), 'y'), 'A.');
  });

  it('documents names only where hover describes a declaration', () => {
    const document = lua('--- Two names.', 'local a, b = 1, 2', '--- Field.', 'function M.f(p) end', '--- Method.', 'function M:m(q) end');
    assert.equal(descriptionAt(document, 'a,'), undefined);
    assert.equal(descriptionAt(document, 'b ='), undefined);
    assert.equal(documentDocs(document).names.size, 0);
  });

  it('gives each parameter of a visible function its @param entry', () => {
    const document = lua(
      '---@param p string The p.',
      'function M.f(p) end',
      '---@param q integer',
      '---@param q string',
      'function M:m(q) end',
      '---@param r boolean',
      'M.g = function(r) end',
      '---@param s number',
      'local h = make(function(s) end)',
    );
    const paramAt = (needle: string): string | undefined => {
      const hit = targetAt(document, document.text.indexOf(needle));
      assert.ok(hit?.target.kind === 'local' && hit.target.declaration.identifier, needle);
      return parameterDoc(document, hit.target.declaration.identifier)?.type;
    };
    assert.equal(paramAt('p) end'), 'string');
    // The first entry wins when a parameter is documented twice.
    assert.equal(paramAt('q) end'), 'integer');
    assert.equal(paramAt('r) end'), 'boolean');
    // A function inside a call is not the documented statement's function.
    assert.equal(paramAt('s) end'), undefined);
  });

  it('records the function of each documented statement, and methods', () => {
    const [field, method, call, none] = documentDocs(lua('---', 'function M.f(p) end', '---', 'function M:m() end', '---', 'f()', '---')).blocks;
    assert.ok(field && method && call && none);
    assert.equal(field.func?.parameters[0]?.name, 'p');
    assert.equal(field.method, false);
    assert.equal(method.method, true);
    assert.equal(call.statement?.kind, 'CallStatement');
    assert.equal(call.func, undefined);
    assert.equal(none.statement, undefined);
  });

  it('reads doc comments in the Lua blocks of .menu files', () => {
    const document = parseDocument('menu\n{\n\tname "M"\n}\n`\n--- Opens it.\nfunction OpenIt() end\n`\n', 'menu');
    assert.equal(descriptionAt(document, 'OpenIt'), 'Opens it.');
  });
});
