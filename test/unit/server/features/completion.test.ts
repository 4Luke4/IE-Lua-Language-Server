import assert from 'node:assert/strict';
import { CompletionItemKind, MarkupKind, type CompletionItem, type Range } from 'vscode-languageserver/node';
import { completionCandidates, type Candidate } from '../../../../src/server/completion/candidates.ts';
import { resolveCompletionItem, toCompletionList, type CompletionClientOptions } from '../../../../src/server/features/completion.ts';
import { allManualEntries, externalEntry } from '../../../../src/server/hover/knowledge.ts';
import { createMessages } from '../../../../src/server/l10n.ts';
import { completionSiteAt } from '../../../../src/server/syntax/completionContext.ts';
import { parseDocument } from '../../../../src/server/syntax/document.ts';

const english = createMessages(undefined);
const insert: Range = { start: { line: 1, character: 4 }, end: { line: 1, character: 6 } };
const replace: Range = { start: { line: 1, character: 4 }, end: { line: 1, character: 9 } };

const pairs = allManualEntries().find((entry) => entry.name === 'pairs');
const addGold = externalEntry('C:AddGold');
assert.ok(pairs && addGold);
const candidates: Candidate[] = [
  { label: 'pairs', kind: 'function', group: 2, target: { kind: 'library', entry: pairs } },
  { label: 'AddGold', kind: 'method', group: 3, target: { kind: 'external', entry: addGold } },
  { label: 'field', kind: 'field', group: 1, target: undefined },
  { label: 'while', kind: 'keyword', group: 4, target: undefined },
];

const options = (overrides: Partial<CompletionClientOptions> = {}): CompletionClientOptions => ({ format: 'markdown', insertReplace: false, defaultEditRange: false, ...overrides });

describe('server/features/completion', () => {
  describe('toCompletionList', () => {
    it('gives each item its kind, sort group, code line and documentation source', () => {
      const { isIncomplete, items } = toCompletionList(candidates, insert, replace, options({ defaultEditRange: true }), english);
      assert.equal(isIncomplete, false);
      assert.deepEqual(items, [
        { label: 'pairs', kind: CompletionItemKind.Function, sortText: '2', detail: 'pairs (t)', data: { source: 'manual', name: 'pairs', runtime: 'lua52' } },
        { label: 'AddGold', kind: CompletionItemKind.Method, sortText: '3', detail: 'C:AddGold', data: { source: 'external', name: 'C:AddGold' } },
        { label: 'field', kind: CompletionItemKind.Field, sortText: '1' },
        { label: 'while', kind: CompletionItemKind.Keyword, sortText: '4' },
      ]);
    });

    it('sends the documentation of doc comments with the item, in the client format, and no data to resolve', () => {
      const text = '--- Adds.\n---@param a integer\nlocal function add(a)\n  return a\nend\n--- Redefined.\nInfinity_DisplayString = nil\nlocal plain\nreturn ';
      const document = parseDocument(text, 'lua');
      const site = completionSiteAt(document, text, text.length);
      assert.ok(site);
      const found = completionCandidates(document, site).filter((candidate) => ['add', 'plain', 'Infinity_DisplayString'].includes(candidate.label));
      const items = (format: CompletionClientOptions['format']): CompletionItem[] => toCompletionList(found, insert, replace, options({ format, defaultEditRange: true }), english).items;
      const [add, plain, eeex] = items('markdown');
      assert.ok(add && plain && eeex);
      assert.deepEqual(add.documentation, { kind: MarkupKind.Markdown, value: 'Adds.\n\n*@param* `a` `integer`' });
      assert.equal(add.data, undefined);
      assert.equal(plain.documentation, undefined);
      // The doc comment and the EEex-Docs link, which needs no resolving either.
      assert.ok(typeof eeex.documentation === 'object');
      assert.match(eeex.documentation.value, /^Redefined\.\n\n---\n\n\[EE Game Lua Functions\]/);
      assert.equal(eeex.data, undefined);
      assert.deepEqual(items('plaintext')[0]?.documentation, { kind: MarkupKind.PlainText, value: 'Adds.\n\n@param a integer' });
    });

    it('sends the edit range once when the client supports item defaults', () => {
      assert.deepEqual(toCompletionList(candidates, insert, replace, options({ defaultEditRange: true }), english).itemDefaults, { editRange: insert });
      assert.deepEqual(toCompletionList(candidates, insert, replace, options({ defaultEditRange: true, insertReplace: true }), english).itemDefaults, {
        editRange: { insert, replace },
      });
    });

    it('otherwise gives every item its edit: insert/replace when supported, else up to the cursor', () => {
      const [plain] = toCompletionList(candidates, insert, replace, options(), english).items;
      assert.deepEqual(plain?.textEdit, { range: insert, newText: 'pairs' });
      const [both] = toCompletionList(candidates, insert, replace, options({ insertReplace: true }), english).items;
      assert.deepEqual(both?.textEdit, { insert, replace, newText: 'pairs' });
      assert.equal(toCompletionList(candidates, insert, replace, options(), english).itemDefaults, undefined);
    });
  });

  describe('resolveCompletionItem', () => {
    it('adds the hover documentation in the client format, without the code line', () => {
      const item: CompletionItem = { label: 'pairs', data: { source: 'manual', name: 'pairs' } };
      const markdown = resolveCompletionItem(item, 'markdown', english).documentation;
      assert.ok(typeof markdown === 'object' && markdown.kind === MarkupKind.Markdown);
      assert.ok(markdown.value.startsWith('If `t` has a metamethod `__pairs`'), markdown.value);
      assert.ok(markdown.value.endsWith('[Lua 5.2 Reference Manual, §6.1 – Basic Functions](https://www.lua.org/manual/5.2/manual.html#pdf-pairs)'));
      const plain = resolveCompletionItem(item, 'plaintext', english).documentation;
      assert.ok(typeof plain === 'object' && plain.kind === MarkupKind.PlainText && !plain.value.includes('`'));
    });

    it('links EEex-Docs entries and notes the engine replacement of print', () => {
      const link = resolveCompletionItem({ label: 'AddGold', data: { source: 'external', name: 'C:AddGold' } }, 'markdown', english).documentation;
      assert.ok(typeof link === 'object' && /^\[EE Game Lua Functions\]\(https:\/\/eeex-docs\.readthedocs\.io\//.test(link.value));
      const print = resolveCompletionItem({ label: 'print', data: { source: 'engineReplaced', name: 'print' } }, 'markdown', english).documentation;
      assert.ok(typeof print === 'object' && print.value.startsWith('The game engine replaces `print`'));
    });

    it('returns other items unchanged', () => {
      for (const item of [{ label: 'x' }, { label: 'x', data: 1 }, { label: 'x', data: { source: 'manual', name: 'io.open' } }] as CompletionItem[]) {
        assert.equal(resolveCompletionItem(item, 'markdown', english), item);
      }
    });
  });
});
