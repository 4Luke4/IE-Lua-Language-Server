import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SemanticTokenModifiers, SemanticTokensBuilder, SemanticTokenTypes } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { LEGEND, pushTokens } from '../../../../src/server/features/semanticTokens.ts';
import { classifyNames } from '../../../../src/server/semanticTokens/classify.ts';
import { parseDocument } from '../../../../src/server/syntax/document.ts';

/** The pushes for `text`: `[line, character, length, type, modifiers]`, decoded to names. */
function pushes(text: string, range?: { start: number; end: number }): string[] {
  const document = TextDocument.create('file:///t.lua', 'lua', 1, text);
  const out: string[] = [];
  pushTokens(
    {
      push: (line, character, length, type, modifiers) => {
        const names = LEGEND.tokenModifiers.filter((_, i) => (modifiers & (1 << i)) !== 0);
        out.push(`${String(line)}:${String(character)}+${String(length)} ${LEGEND.tokenTypes[type] ?? '?'} ${names.join(',')}`.trimEnd());
      },
    },
    classifyNames(parseDocument(text, 'lua')),
    (offset) => document.positionAt(offset),
    range,
  );
  return out;
}

describe('server/features/semanticTokens', () => {
  it('uses only standard token types, and standard modifiers plus the declared "global"', () => {
    const standardTypes: readonly string[] = Object.values(SemanticTokenTypes);
    const standardModifiers: readonly string[] = Object.values(SemanticTokenModifiers);
    for (const type of LEGEND.tokenTypes) assert.ok(standardTypes.includes(type), type);
    const custom = LEGEND.tokenModifiers.filter((modifier) => !standardModifiers.includes(modifier));
    assert.deepEqual(custom, ['global']);
  });

  it('declares every custom modifier in the extension manifest', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')) as { contributes: { semanticTokenModifiers?: { id: string }[] } };
    assert.deepEqual(manifest.contributes.semanticTokenModifiers?.map((modifier) => modifier.id), ['global']);
  });

  it('pushes line, UTF-16 character, length, legend type and modifier bits', () => {
    assert.deepEqual(pushes('local x = 1\n  print(x)'), ['0:6+1 variable declaration', '1:2+5 function defaultLibrary,global', '1:8+1 variable']);
  });

  it('counts characters in UTF-16 code units', () => {
    // `é` is one UTF-16 code unit, `😀` two: the last `s` is at character 23 (22 in code points).
    assert.deepEqual(pushes('local s = "é😀" return s'), ['0:6+1 variable declaration', '0:23+1 variable']);
  });

  it('keeps only the tokens that overlap the range', () => {
    const text = 'local a = 1\nlocal b = a\nlocal c = b';
    const start = text.indexOf('local b');
    assert.deepEqual(pushes(text, { start, end: start + 'local b = a'.length }), ['1:6+1 variable declaration', '1:10+1 variable']);
    assert.deepEqual(pushes(text, { start: 0, end: 0 }), []);
  });

  it('builds the delta of a document against its previous result', () => {
    const builder = new SemanticTokensBuilder();
    const fill = (text: string): void => {
      const document = TextDocument.create('file:///t.lua', 'lua', 1, text);
      pushTokens(builder, classifyNames(parseDocument(text, 'lua')), (offset) => document.positionAt(offset));
    };
    fill('local a = 1');
    const first = builder.build();
    builder.previousResult(first.resultId ?? '');
    fill('local a = 1 return a');
    const delta = builder.buildEdits();
    assert.ok('edits' in delta, 'a delta against the previous result');
    builder.previousResult('unknown');
    fill('local b');
    assert.ok('data' in builder.buildEdits(), 'a full result when the previous one is unknown');
  });
});
