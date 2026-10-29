import { lexMenu, type MenuToken } from './menuLexer.ts';
import { CHUNK_FORM, EXPRESSION_FORM, STATEMENT_FORM, type CompiledForm, type LuaChunk, type Problem } from './types.ts';

// Which property values are Lua, from IESDP, "MENU file format", section "How a
// menu becomes Lua" (https://gibberlings3.github.io/iesdp/file_formats/ie_formats/menu_v1.htm,
// commit 38e7532). Keywords in lower case, as `menuKeyword` returns them.

/** Properties whose STRING is compiled as a function body (one or more statements). */
export const STATEMENT_PROPERTIES: ReadonlySet<string> = new Set([
  'onopen',
  'onclose',
  'action',
  'actionalt',
  'actiondbl',
  'actionenter',
  'actionexit',
  'actionupdate',
  'actionsimpledrag',
  'actionsimpledrop',
  'actionhold',
  'actionscroll',
]);

/**
 * Properties whose STRING is compiled as `return <expression>`. `bitmap res` and
 * every `lua STRING` value are expressions too; they are recognized separately.
 */
export const EXPRESSION_PROPERTIES: ReadonlySet<string> = new Set([
  'enabled',
  'actiondrag',
  'table',
  'seperator',
  'useoverlaytint',
]);

/** An expression the engine generates from a shorthand STRING `T`: `<before>T<after>`. */
function generatedExpression(before: string, after: string): CompiledForm {
  return { prefix: EXPRESSION_FORM.prefix + before, suffix: after + EXPRESSION_FORM.suffix };
}

/** A statement the engine generates from a shorthand STRING `T`: `<before>T<after>`. */
function generatedStatement(before: string, after: string): CompiledForm {
  return { prefix: STATEMENT_FORM.prefix + before, suffix: after + STATEMENT_FORM.suffix };
}

const SPELL_INFO_COMMON: readonly CompiledForm[] = [
  generatedExpression('', ' ~= nil'), // enabled
  generatedExpression('', '.icon'), // icon lua
  generatedExpression('Infinity_FetchString(', '.name)'), // tooltip lua
  generatedExpression('', '.castable == 0'), // greyscale lua
  // bam lua "'IVSLOT'" does not contain T, so it cannot fail.
];

/**
 * Shorthand properties whose STRING `T` the engine pastes into generated Lua
 * (IESDP, MENU file format, Item properties › Slots). Each STRING is validated
 * in every generated form, and parsed as an expression for navigation.
 */
export const SHORTHAND_FORMS: ReadonlyMap<string, readonly CompiledForm[]> = new Map([
  [
    'slotinfo',
    [
      generatedExpression('', '.item.icon'), // icon lua
      generatedExpression('', '.item.count'), // count lua
      generatedExpression('', '.item.usages'), // usages lua
      generatedExpression('', '.highlight'), // highlight lua
      generatedExpression('', '.item.tint'), // tint lua
      generatedExpression('', '.tooltip'), // tooltip lua
      generatedExpression('', '.valid'), // enabled
      generatedExpression('Infinity_SwapSlot(', '.id)'), // action (expression)
      generatedStatement('showItemDescriptionInventory(', '.slotName)'), // actionalt
      generatedStatement('slotDoubleClick(', '.slotName)'), // actiondbl
    ],
  ],
  [
    'spellinfo',
    [
      ...SPELL_INFO_COMMON,
      generatedExpression('memorizeSpell(', ')'), // action (expression)
      generatedStatement('showSpellDetails(', ', false)'), // actionalt
    ],
  ],
  [
    'memorizedspellinfo',
    [
      ...SPELL_INFO_COMMON,
      generatedExpression('unmemorizeSpell(', ')'), // action (expression)
      generatedStatement('showSpellDetails(', ', true)'), // actionalt
    ],
  ],
]);

/** A word of a .menu file, as half-open document offsets. */
export interface MenuWord {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** A `{ … }` block of a .menu file (`menu`, `button`, `label`, …). */
export interface MenuBlock {
  /**
   * The keyword just before `{`, as written: `menu`, `button`, `column`, …
   * `undefined` when `{` follows anything else.
   */
  readonly keyword: MenuWord | undefined;
  /** Offset of `{`. */
  readonly open: number;
  /** Offset of the matching `}`; `undefined` when the block is never closed. */
  readonly close: number | undefined;
  /**
   * The STRING of the first `name` property directly inside the block: `name "…"`,
   * `name '…'` (offsets exclude the quotes) or an unquoted `name WORD`.
   */
  readonly name: MenuWord | undefined;
  readonly children: readonly MenuBlock[];
}

export interface MenuExtraction {
  readonly chunks: LuaChunk[];
  readonly problems: Problem[];
  /** Top-level `{ … }` blocks, with their nested blocks. */
  readonly blocks: MenuBlock[];
}

interface OpenBlock {
  keyword: MenuWord | undefined;
  open: number;
  close: number | undefined;
  name: MenuWord | undefined;
  children: OpenBlock[];
}

/**
 * Finds the Lua embedded in an Infinity Engine `.menu` file, from the tokens of
 * `lexMenu` (which follows the engine's lexer):
 *
 * - `` `…` `` blocks: a Lua chunk, without the last character before the
 *   closing backtick, which the engine drops.
 * - a STRING after a property in STATEMENT_PROPERTIES: Lua statements.
 * - a STRING after a property in EXPRESSION_PROPERTIES, after `bitmap res`, or
 *   after `lua`: a Lua expression.
 * - a STRING after `slotinfo`, `spellInfo` or `memorizedSpellInfo`: an
 *   expression the engine pastes into the Lua of SHORTHAND_FORMS.
 *
 * A STRING is a `"…"` or `'…'` string, or a word that is not a keyword (the
 * engine treats both alike: `enabled currentSave` is the expression
 * `currentSave`). The engine's grammar is token based, so line breaks don't
 * matter. An unterminated string is reported by the lexer and is not Lua.
 *
 * The same pass records the nesting of `{ … }` blocks and their `name`.
 */
export function extractMenuLua(text: string): MenuExtraction {
  const { tokens, inline, problems } = lexMenu(text);
  const chunks: LuaChunk[] = inline.map((block) => ({
    kind: 'statements',
    origin: 'block',
    offset: block.start + 1,
    region: { start: block.start, end: block.close + 1 },
    // The engine drops the last character before the closing backtick (IESDP,
    // Lexical structure); the chunk is the text it actually runs.
    text: text.slice(block.start + 1, Math.max(block.start + 1, block.close - 1)),
    forms: [CHUNK_FORM],
  }));
  const blocks: OpenBlock[] = [];
  /** Blocks whose `}` has not been seen yet, innermost last. */
  const open: OpenBlock[] = [];
  const word = (token: MenuToken): MenuWord => ({
    text: text.slice(token.valueStart, token.valueEnd),
    start: token.valueStart,
    end: token.valueEnd,
  });

  tokens.forEach((token, index) => {
    const previous = tokens[index - 1];
    if (token.type === '{') {
      const block: OpenBlock = {
        keyword: previous?.type === 'keyword' ? word(previous) : undefined,
        open: token.start,
        close: undefined,
        name: undefined,
        children: [],
      };
      (open.at(-1)?.children ?? blocks).push(block);
      open.push(block);
    } else if (token.type === '}') {
      const block = open.pop();
      if (block) block.close = token.start;
    } else if (token.type === 'string' && previous?.type === 'keyword') {
      const kind = classify(previous, tokens[index - 2]);
      const shorthand = previous.keyword === undefined ? undefined : SHORTHAND_FORMS.get(previous.keyword);
      // An unterminated string runs to the end of the file; it is reported, not validated.
      const terminated = token.quote === undefined || token.end > token.valueEnd;
      if ((kind || shorthand) && terminated) {
        chunks.push({
          kind: kind ?? 'expression',
          origin: 'property',
          offset: token.valueStart,
          region: { start: token.start, end: token.end },
          text: text.slice(token.valueStart, token.valueEnd),
          forms: shorthand ?? [kind === 'statements' ? STATEMENT_FORM : EXPRESSION_FORM],
        });
      }
      const block = open.at(-1);
      if (block && block.name === undefined && previous.keyword === 'name') {
        block.name = word(token);
      }
    }
  });
  chunks.sort((a, b) => a.offset - b.offset);
  return { chunks, problems, blocks };
}

/** Whether a STRING after `property` (preceded by `before`) is Lua, and of which kind. */
function classify(property: MenuToken, before: MenuToken | undefined): LuaChunk['kind'] | undefined {
  const keyword = property.keyword;
  if (keyword === undefined) return undefined;
  if (STATEMENT_PROPERTIES.has(keyword)) return 'statements';
  if (EXPRESSION_PROPERTIES.has(keyword) || keyword === 'lua') return 'expression';
  if (keyword === 'res' && before?.keyword === 'bitmap') return 'expression';
  return undefined;
}
