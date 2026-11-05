import assert from 'node:assert/strict';
import { parseDocComment, scanType, type DocLine } from '../../../../src/server/docComments/parse.ts';

/** Doc lines from the text after each `---`, at made-up offsets 100 apart. */
const lines = (...texts: string[]): DocLine[] => texts.map((text, i) => ({ text, start: i * 100 }));

const typeOf = (text: string): string => text.slice(0, scanType(text, 0));

describe('server/docComments/parse', () => {
  describe('scanType', () => {
    it('ends a simple type at white space', () => {
      assert.equal(typeOf('integer the count'), 'integer');
      assert.equal(typeOf('string?'), 'string?');
      assert.equal(typeOf('string[] names'), 'string[]');
    });

    it('keeps unions together, with or without spaces around |', () => {
      assert.equal(typeOf('string|nil x'), 'string|nil');
      assert.equal(typeOf('string | nil x'), 'string | nil');
      assert.equal(typeOf('"a" | "b" c'), '"a" | "b"');
    });

    it('runs through balanced brackets and quotes', () => {
      assert.equal(typeOf('table<string, integer> map'), 'table<string, integer>');
      assert.equal(typeOf('{ x: number, y: number } point'), '{ x: number, y: number }');
      assert.equal(typeOf('"a b" rest'), '"a b"');
      assert.equal(typeOf("'a b' rest"), "'a b'");
    });

    it('keeps the return list of a function type', () => {
      assert.equal(typeOf('fun(a: integer): string callback'), 'fun(a: integer): string');
      assert.equal(typeOf('fun(): string, boolean callback'), 'fun(): string, boolean');
    });

    it('does not continue after a colon or comma that is not part of a function type', () => {
      assert.equal(typeOf('integer: count'), 'integer:');
      assert.equal(typeOf('integer, count'), 'integer,');
    });

    it('takes the rest of the line when a bracket is never closed', () => {
      assert.equal(typeOf('table<string, integer'), 'table<string, integer');
    });
  });

  describe('parseDocComment', () => {
    it('joins description lines, removing one leading space from each', () => {
      const doc = parseDocComment(lines(' Greets someone.', '', '  Indented **Markdown**.'));
      assert.equal(doc.description, 'Greets someone.\n\n Indented **Markdown**.');
    });

    it('drops leading and trailing empty description lines', () => {
      assert.equal(parseDocComment(lines('', ' Text', ' ')).description, 'Text');
      assert.equal(parseDocComment(lines('', '')).description, '');
    });

    it('treats "--- @tag" as description text, as the reference writes tags as "---@tag"', () => {
      const doc = parseDocComment(lines(' @param x integer'));
      assert.equal(doc.description, '@param x integer');
      assert.deepEqual(doc.params, []);
    });

    it('parses @param with optional marker, vararg, type and description', () => {
      const doc = parseDocComment(lines('@param name string The name.', '@param count? integer', '@param ... any Values.'));
      assert.deepEqual(
        doc.params.map(({ name, optional, type, description }) => ({ name, optional, type, description })),
        [
          { name: 'name', optional: false, type: 'string', description: 'The name.' },
          { name: 'count', optional: true, type: 'integer', description: '' },
          { name: '...', optional: false, type: 'any', description: 'Values.' },
        ],
      );
      // The name span excludes `?`.
      assert.deepEqual(doc.params[1]?.nameSpan, { start: 107, end: 112 });
      assert.deepEqual(doc.params[0]?.nameSpan, { start: 7, end: 11 });
    });

    it('keeps @param descriptions verbatim', () => {
      assert.equal(parseDocComment(lines('@param x integer # the count')).params[0]?.description, '# the count');
    });

    it('parses the @return forms of the reference', () => {
      const returns = parseDocComment(
        lines('@return boolean enabled If the item is enabled', '@return boolean # If the item is enabled', '@return boolean ok # true on success', '@return string ...', '@return integer'),
      ).tags.map((tag) => (tag.tag === 'return' ? tag.value : undefined));
      assert.deepEqual(returns, [
        { type: 'boolean', name: 'enabled', description: 'If the item is enabled' },
        { type: 'boolean', name: undefined, description: 'If the item is enabled' },
        { type: 'boolean', name: 'ok', description: 'true on success' },
        { type: 'string', name: '...', description: '' },
        { type: 'integer', name: undefined, description: '' },
      ]);
    });

    it('parses @type, @deprecated and @see, in source order', () => {
      const doc = parseDocComment(lines('@deprecated', '@type string | nil', '@see Other'));
      assert.deepEqual(doc.tags, [{ tag: 'deprecated' }, { tag: 'type', type: 'string | nil' }, { tag: 'see', symbol: 'Other' }]);
    });

    it('recognises other tags and union continuation lines without rendering them', () => {
      const doc = parseDocComment(lines(' Text.', '@class Point', '@field x number', '@nodiscard', '|"\'immediate\'" # comment', '@unknown'));
      assert.equal(doc.description, 'Text.');
      assert.deepEqual(doc.tags, []);
      assert.deepEqual(doc.malformed, []);
    });

    it('reports @param without a name or type, and @return or @type without a type', () => {
      const doc = parseDocComment(lines('@param', '@param x', '@param 1x integer', '@return', '@type   ', '@paramx integer'));
      assert.deepEqual(
        doc.malformed.map(({ tag, reason, span }) => ({ tag, reason, span })),
        [
          { tag: '@param', reason: 'paramName', span: { start: 0, end: 6 } },
          { tag: '@param', reason: 'paramType', span: { start: 100, end: 108 } },
          { tag: '@param', reason: 'paramName', span: { start: 200, end: 217 } },
          { tag: '@return', reason: 'type', span: { start: 300, end: 307 } },
          { tag: '@type', reason: 'type', span: { start: 400, end: 405 } },
        ],
      );
      assert.deepEqual(doc.params, []);
    });
  });
});
