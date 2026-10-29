import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXPRESSION_PROPERTIES, SHORTHAND_FORMS, STATEMENT_PROPERTIES } from '../../../src/server/validation/menuExtractor.ts';
import { MENU_KEYWORDS } from '../../../src/server/validation/menuKeywords.ts';

interface Rule {
  readonly match?: string;
  readonly begin?: string;
}

const grammar = JSON.parse(readFileSync(new URL('../../../syntaxes/ie-menu.tmLanguage.json', import.meta.url), 'utf8')) as {
  readonly repository: Readonly<Record<string, Rule>>;
};

/** The words of every `(…|…)` / `(?:…|…)` alternation in a pattern, in lower case. */
function alternatives(pattern: string | undefined): Set<string> {
  const words = new Set<string>();
  for (const group of (pattern ?? '').matchAll(/\((?:\?:)?([A-Za-z|]+)\)/g)) {
    for (const word of group[1]?.split('|') ?? []) words.add(word.toLowerCase());
  }
  return words;
}

const sorted = (words: Iterable<string>): string[] => [...words].sort();

// The grammar is static JSON; these checks keep it in step with the extractor,
// which is the source of truth for what is Lua in a .menu file.
describe('syntaxes/ie-menu.tmLanguage.json', () => {
  it('highlights exactly the engine keywords', () => {
    assert.deepEqual(sorted(alternatives(grammar.repository['keyword']?.match)), sorted(MENU_KEYWORDS.map((k) => k.toLowerCase())));
  });

  it('embeds Lua after exactly the properties the extractor treats as Lua', () => {
    const expected = [...STATEMENT_PROPERTIES, ...EXPRESSION_PROPERTIES, ...SHORTHAND_FORMS.keys(), 'lua', 'bitmap', 'res'];
    assert.deepEqual(sorted(alternatives(grammar.repository['lua-property']?.begin)), sorted(expected));
  });

  it('marks the item types and menu/column as elements, all of them keywords', () => {
    const elements = alternatives(grammar.repository['element']?.match);
    assert.deepEqual(sorted(elements), sorted(['menu', 'label', 'text', 'button', 'list', 'edit', 'movie', 'slider', 'handle', 'slot', 'map', 'template', 'column']));
    const keywords = new Set(MENU_KEYWORDS.map((k) => k.toLowerCase()));
    for (const element of elements) assert.ok(keywords.has(element), element);
  });
});
