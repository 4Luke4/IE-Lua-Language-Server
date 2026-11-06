import assert from 'node:assert/strict';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParsedDocumentCache } from '../../../../src/server/documentCache.ts';
import {
  dynamicRegistration,
  formatterOptions,
  formattingEdits,
  FORMAT_SELECTOR,
  staticCapabilities,
  type FormattingLog,
  type Formatters,
} from '../../../../src/server/features/formatting.ts';
import { formatDocument } from '../../../../src/server/formatting/format.ts';
import { formatMenuDocument } from '../../../../src/server/formatting/menuFormat.ts';

const OPTIONS = { tabSize: 2, insertSpaces: true };

const formatters = (options = OPTIONS): Formatters => ({
  lua: (source, tree) => formatDocument(source, tree, options),
  menu: (parsed) => formatMenuDocument(parsed, options),
});

function run(uri: string, languageId: string, text: string, refusalLevel?: 'debug' | 'info'): { edits: ReturnType<typeof formattingEdits>; logged: string[] } {
  const logged: string[] = [];
  const log: FormattingLog = (level, message) => logged.push(`${level}: ${message}`);
  const document = TextDocument.create(uri, languageId, 1, text);
  const edits = formattingEdits(document, new ParsedDocumentCache(), 'lua52', formatters(), log, refusalLevel);
  return { edits, logged };
}

describe('server/features/formatting', () => {
  it('converts offset edits to LSP ranges', () => {
    const { edits } = run('file:///a.lua', 'lua', 'do\nx=1\nend');
    assert.deepEqual(edits, [
      { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, newText: '  ' },
      { range: { start: { line: 1, character: 1 }, end: { line: 1, character: 1 } }, newText: ' ' },
      { range: { start: { line: 1, character: 2 }, end: { line: 1, character: 2 } }, newText: ' ' },
    ]);
  });

  it('formats .menu documents, by language ID or by extension', () => {
    const expected = [{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, newText: '  ' }];
    assert.deepEqual(run('file:///UI.MENU', 'ie-menu', 'menu {\nname "m"\n}').edits, expected);
    assert.deepEqual(run('file:///UI.MENU', 'plaintext', 'menu {\nname "m"\n}').edits, expected);
  });

  it('answers null and logs why for .menu files with an unterminated string', () => {
    const { edits, logged } = run('file:///UI.MENU', 'ie-menu', 'name "m');
    assert.equal(edits, null);
    assert.deepEqual(logged, ['info: Not formatting file:///UI.MENU: it has an unterminated string or Lua block.']);
  });

  it('formats the rest of a .menu file and logs the Lua chunks left as written', () => {
    const { edits, logged } = run('file:///UI.MENU', 'ie-menu', 'menu {\nonOpen "if x then"\nname "m"\n}');
    assert.equal(edits?.length, 2);
    assert.deepEqual(logged, ['info: Formatting file:///UI.MENU: 1 Lua chunk(s) with a syntax error left as written.']);
  });

  it('answers null and logs why for syntax errors', () => {
    const { edits, logged } = run('file:///a.lua', 'lua', 'x = ');
    assert.equal(edits, null);
    assert.deepEqual(logged, ['info: Not formatting file:///a.lua: it has a syntax error before the end of the formatted lines.']);
  });

  it('logs an invalid tabSize as an error, whatever the request', () => {
    const logged: string[] = [];
    const document = TextDocument.create('file:///a.lua', 'lua', 1, 'x = 1');
    const edits = formattingEdits(
      document,
      new ParsedDocumentCache(),
      'lua52',
      formatters({ tabSize: 0, insertSpaces: true }),
      (level, message) => logged.push(`${level}: ${message}`),
      'debug',
    );
    assert.equal(edits, null);
    assert.deepEqual(logged, ['error: Not formatting file:///a.lua: with insertSpaces, tabSize must be an integer from 1 to 100.']);
  });

  it('logs refusals at the level asked for, so that on-type requests stay quiet', () => {
    const { logged } = run('file:///a.lua', 'lua', 'x = ', 'debug');
    assert.deepEqual(logged, ['debug: Not formatting file:///a.lua: it has a syntax error before the end of the formatted lines.']);
  });

  it('passes on only the options the formatter honors', () => {
    assert.deepEqual(formatterOptions({ tabSize: 4, insertSpaces: false, trimTrailingWhitespace: true, insertFinalNewline: true, custom: 'x' }), {
      tabSize: 4,
      insertSpaces: false,
      insertFinalNewline: true,
      trimFinalNewlines: undefined,
    });
  });

  it('advertises statically only what the client does not register dynamically', () => {
    assert.deepEqual(staticCapabilities(dynamicRegistration(undefined)), {
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      documentOnTypeFormattingProvider: { firstTriggerCharacter: '\n', moreTriggerCharacter: ['d', 'e', 'f', 'l', ')', ']', '}'] },
    });
    const dynamic = dynamicRegistration({
      formatting: { dynamicRegistration: true },
      rangeFormatting: { dynamicRegistration: true },
      onTypeFormatting: { dynamicRegistration: false },
    });
    assert.deepEqual(Object.keys(staticCapabilities(dynamic)), ['documentOnTypeFormattingProvider']);
  });

  it('selects Lua and .menu documents by language ID and by extension in any letter case, for the served schemes', () => {
    assert.deepEqual(FORMAT_SELECTOR, [
      { language: 'lua', scheme: 'file' },
      { scheme: 'file', pattern: '**/*.[lL][uU][aA]' },
      { language: 'ie-menu', scheme: 'file' },
      { scheme: 'file', pattern: '**/*.[mM][eE][nN][uU]' },
      { language: 'lua', scheme: 'untitled' },
      { scheme: 'untitled', pattern: '**/*.[lL][uU][aA]' },
      { language: 'ie-menu', scheme: 'untitled' },
      { scheme: 'untitled', pattern: '**/*.[mM][eE][nN][uU]' },
    ]);
  });
});
