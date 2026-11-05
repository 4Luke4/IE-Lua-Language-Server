import assert from 'node:assert/strict';
import { checkDocComments } from '../../../../src/server/docComments/check.ts';
import { createMessages } from '../../../../src/server/l10n.ts';
import { parseDocument } from '../../../../src/server/syntax/document.ts';

const english = createMessages(undefined);

/** `[code, problem text]` for each problem of the Lua `lines`. */
function check(...lines: string[]): [string, string][] {
  const text = lines.join('\n');
  return checkDocComments(parseDocument(text, 'lua'), english).map((problem) => [problem.code, text.slice(problem.start, problem.end)]);
}

describe('server/docComments/check', () => {
  it('accepts parameters the function has, `...` of a vararg function and `self` of a method', () => {
    assert.deepEqual(check('---@param a integer', '---@param ... any', 'local function f(a, ...) end', '---@param self M', 'function M:m() end'), []);
  });

  it('reports @param names the documented function does not have', () => {
    assert.deepEqual(check('---@param b integer', '---@param ... any', '---@param self M', 'local function f(a) end'), [
      ['doc-param-unknown', 'b'],
      ['doc-param-unknown', '...'],
      ['doc-param-unknown', 'self'],
    ]);
    assert.deepEqual(check('---@param x? integer', 'G = function() end'), [['doc-param-unknown', 'x']]);
  });

  it('does not check parameters where the function is not written in the statement', () => {
    assert.deepEqual(check('---@param x integer', 'local f = make()'), []);
    assert.deepEqual(check('---@param x integer'), []);
    assert.deepEqual(check('---@param x integer', '', 'local function f() end'), []);
  });

  it('reports a parameter documented twice, once for each repetition', () => {
    assert.deepEqual(check('---@param a integer', '---@param a string', '---@param a nil', 'local function f(a) end'), [
      ['doc-param-duplicate', 'a'],
      ['doc-param-duplicate', 'a'],
    ]);
  });

  it('reports incomplete tags in any doc block, in source order', () => {
    assert.deepEqual(check('---@return', '---@param', '---@type  ', '---@param x', 'local y'), [
      ['doc-tag-malformed', '@return'],
      ['doc-tag-malformed', '@param'],
      ['doc-tag-malformed', '@type'],
      ['doc-tag-malformed', '@param x'],
    ]);
  });

  it('says what is wrong, naming the tag and the parameter', () => {
    const messages = checkDocComments(parseDocument('---@param\n---@param x\n---@return\n---@param b integer\n---@param b integer\nlocal function f(a) end', 'lua'), english).map(
      (problem) => problem.message,
    );
    assert.deepEqual(messages, [
      '@param needs a parameter name followed by a type.',
      '@param needs a type after the parameter name.',
      '@return needs a type.',
      'The documented function has no parameter "b".',
      'Parameter "b" is already documented in this comment.',
    ]);
  });

  it('localizes the messages', () => {
    const [problem] = checkDocComments(parseDocument('---@return\nlocal x', 'lua'), createMessages('de'));
    assert.ok(problem);
    assert.equal(problem.message, '@return benötigt einen Typ.');
    assert.equal(problem.severity, 'warning');
  });
});
