import assert from 'node:assert/strict';
import type * as Ast from '../../../../src/server/syntax/ast.ts';
import { parseDocument, type ParsedDocument } from '../../../../src/server/syntax/document.ts';
import { targetAt } from '../../../../src/server/syntax/navigation.ts';
import { declarationSite, parameterList } from '../../../../src/server/syntax/signatures.ts';

function siteAt(document: ParsedDocument, text: string, needle: string): ReturnType<typeof declarationSite> {
  const hit = targetAt(document, text.indexOf(needle));
  assert.ok(hit, needle);
  return declarationSite(document, hit.identifier);
}

const params = (func: Ast.FunctionExpression): string => parameterList(func);

describe('server/syntax/signatures', () => {
  const text = 'local function lf(a, b, ...) end local lv, lw = function(c) end function G(d) end H, I = 1 local J';
  const document = parseDocument(text, 'lua');

  it('describes local functions and function declarations with their parameter lists', () => {
    const lf = siteAt(document, text, 'lf');
    assert.equal(lf?.kind === 'localFunction' && params(lf.func), '(a, b, ...)');
    const g = siteAt(document, text, 'G(');
    assert.equal(g?.kind === 'functionDeclaration' && params(g.func), '(d)');
  });

  it('pairs each declared or assigned name with the value in the same position', () => {
    const lv = siteAt(document, text, 'lv');
    assert.equal(lv?.kind === 'local' && lv.value?.kind, 'FunctionExpression');
    assert.deepEqual(siteAt(document, text, 'lw'), { kind: 'local', value: undefined });
    assert.equal(siteAt(document, text, 'H,')?.kind, 'assignment');
    assert.deepEqual(siteAt(document, text, 'I ='), { kind: 'assignment', value: undefined });
    assert.deepEqual(siteAt(document, text, 'J'), { kind: 'local', value: undefined });
  });

  it('has no site for parameters, reads, or names with fields or a method', () => {
    const source = 'function t.f(p) return p end function t:m() end print(q)';
    const parsed = parseDocument(source, 'lua');
    for (const needle of ['t.f', 'p)', 't:m', 'q']) {
      assert.equal(siteAt(parsed, source, needle), undefined, needle);
    }
  });
});
