import assert from 'node:assert/strict';
import { parseDocComment, type DocLine } from '../../../../src/server/docComments/parse.ts';
import { codeSpan, renderDocComment, renderParam } from '../../../../src/server/docComments/render.ts';

const lines = (...texts: string[]): DocLine[] => texts.map((text, i) => ({ text, start: i * 100 }));

describe('server/docComments/render', () => {
  describe('codeSpan', () => {
    it('uses one backtick for text without any', () => {
      assert.equal(codeSpan('string|nil'), '`string|nil`');
    });

    it('uses more backticks than the longest run inside, padded where a backtick touches the fence', () => {
      assert.equal(codeSpan('a`b'), '``a`b``');
      assert.equal(codeSpan('``x'), '``` ``x ```');
      assert.equal(codeSpan('x`'), '`` x` ``');
    });

    it('pads text that starts and ends with a space, which CommonMark would strip', () => {
      assert.equal(codeSpan(' x '), '`  x  `');
      assert.equal(codeSpan(' x'), '` x`');
    });
  });

  describe('renderDocComment', () => {
    it('gives nothing for a block without description or rendered tags', () => {
      assert.equal(renderDocComment(parseDocComment(lines('@class Point', '@field x number')), 'markdown'), undefined);
    });

    it('gives the description alone, or the tags alone', () => {
      assert.equal(renderDocComment(parseDocComment(lines(' Only text.')), 'markdown'), 'Only text.');
      assert.equal(renderDocComment(parseDocComment(lines('@deprecated', '@see Other')), 'markdown'), '*@deprecated*  \n\n*@see* — Other');
      assert.equal(renderDocComment(parseDocComment(lines('@deprecated', '@see Other')), 'plaintext'), '@deprecated\n@see — Other');
    });
  });

  describe('renderParam', () => {
    it('marks optional parameters and leaves out an empty description', () => {
      const [optional, vararg] = parseDocComment(lines('@param x? integer', '@param ... any Rest.')).params;
      assert.ok(optional && vararg);
      assert.equal(renderParam(optional, 'markdown'), '*@param* `x?` `integer`');
      assert.equal(renderParam(vararg, 'plaintext'), '@param ... any — Rest.');
    });
  });
});
