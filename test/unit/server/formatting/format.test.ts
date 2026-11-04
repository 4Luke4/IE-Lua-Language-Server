import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatDocument,
  formatOnType,
  formatRange,
  type FormatResult,
  type FormattingOptions,
  type OffsetEdit,
} from '../../../../src/server/formatting/format.ts';
import { lex } from '../../../../src/server/syntax/lexer.ts';
import { parseChunk } from '../../../../src/server/syntax/parser.ts';
import { loadLua52, type Lua52Checker } from '../../../../src/server/validation/lua52.ts';

const SPACES: FormattingOptions = { tabSize: 2, insertSpaces: true };

function apply(text: string, edits: readonly OffsetEdit[]): string {
  let result = '';
  let position = 0;
  for (const edit of edits) {
    assert.ok(edit.start >= position, 'edits are disjoint and in order');
    result += text.slice(position, edit.start) + edit.newText;
    position = edit.end;
  }
  return result + text.slice(position);
}

function edits(result: FormatResult): readonly OffsetEdit[] {
  assert.ok(result.ok, `formatting was refused: ${result.ok ? '' : result.reason}`);
  return result.edits;
}

/** Formats a whole document given as lines joined with `\n`. */
function format(lines: readonly string[], options: FormattingOptions = SPACES): string[] {
  const text = lines.join('\n');
  return apply(text, edits(formatDocument(text, parseChunk(text), options))).split('\n');
}

/** Formats one line of code on its own. */
const line = (code: string): string => format([code])[0] ?? '';

describe('server/formatting/format', () => {
  describe('spacing within a line', () => {
    it('puts one space around binary operators, `=` and `..`', () => {
      assert.equal(line('x=a+b*c-d/e%f^g'), 'x = a + b * c - d / e % f ^ g');
      assert.equal(line('x=a==b and c~=d or e<=f'), 'x = a == b and c ~= d or e <= f');
      assert.equal(line('x=a<b==(c>d)==(e>=f)'), 'x = a < b == (c > d) == (e >= f)');
      assert.equal(line("s=a..'x'..1 .. 2"), "s = a .. 'x' .. 1 .. 2");
    });

    it('puts no space after unary `-` and `#`, and one after `not`', () => {
      assert.equal(line('x = - a + # t'), 'x = -a + #t');
      assert.equal(line('x = not  a'), 'x = not a');
      assert.equal(line('x = -(a)'), 'x = -(a)');
    });

    it('keeps a space between two minus signs, which would otherwise start a comment', () => {
      assert.equal(line('x = - -a'), 'x = - -a');
      assert.equal(line('x = a- -b'), 'x = a - -b');
      assert.equal(line('x = -#t'), 'x = -#t');
    });

    it('puts no space before `,` and `;`, and one after them', () => {
      assert.equal(line('local a ,b,c = 1 ,2;'), 'local a, b, c = 1, 2;');
      assert.equal(line('t = {1;2 , 3}'), 't = { 1; 2, 3 }');
    });

    it('puts no space inside parentheses and brackets', () => {
      assert.equal(line('x = ( a + b ) * t[ 1 ]'), 'x = (a + b) * t[1]');
      assert.equal(line('f( )'), 'f()');
    });

    it('keeps a space between a bracket and a long string, which would otherwise read as `[[`', () => {
      assert.equal(line('x = t[ [[k]] ]'), 'x = t[ [[k]] ]');
      assert.equal(line('x = t[[=[k]=]]'), 'x = t[[=[k]=]]');
    });

    it('puts one space inside braces, and none in `{}`', () => {
      assert.equal(line('t = {a,b}'), 't = { a, b }');
      assert.equal(line('t = {  }'), 't = {}');
      assert.equal(line('t = {[1]=2,x=3}'), 't = { [1] = 2, x = 3 }');
    });

    it('puts no space around `.` and `:`', () => {
      assert.equal(line('a . b : c ( )'), 'a.b:c()');
      assert.equal(line('function a . b : c ( ) end'), 'function a.b:c() end');
    });

    it('puts no space before the parentheses of a call, a function or the bracket of an index', () => {
      assert.equal(line('f (a) (b)'), 'f(a)(b)');
      assert.equal(line('x = function (a) end'), 'x = function(a) end');
      assert.equal(line('local function f (a) end'), 'local function f(a) end');
      assert.equal(line('x = t [1] [2]'), 'x = t[1][2]');
      assert.equal(line('x = f() [1]'), 'x = f()[1]');
    });

    it('keeps string and table call arguments joined or apart, as written', () => {
      assert.equal(line('f"x" g  "y"'), 'f"x" g "y"');
      assert.equal(line('f{1} g  {2}'), 'f{ 1 } g { 2 }');
      assert.equal(line('f[[x]] g   [[y]]'), 'f[[x]] g [[y]]');
      // Chains: an argument after another argument, or after an index.
      assert.equal(line('f"a""b"  "c"'), 'f"a""b" "c"');
      assert.equal(line('f{}{}  {}'), 'f{}{} {}');
      assert.equal(line('t[1]"x" t[1]  "y"'), 't[1]"x" t[1] "y"');
    });

    it('puts one space around keywords', () => {
      assert.equal(line('if(a)then return(b)end'), 'if (a) then return (b) end');
      assert.equal(line('for i=1,2 do end'), 'for i = 1, 2 do end');
      assert.equal(line('for k,v in pairs(t)do end'), 'for k, v in pairs(t) do end');
    });

    it('writes labels without spaces inside, and spaces around them', () => {
      assert.equal(line('::  top  ::goto top'), '::top:: goto top');
    });

    it('keeps the space written before a trailing comment, and puts one where none was', () => {
      assert.equal(line('x = 1    -- aligned'), 'x = 1    -- aligned');
      assert.equal(line('x = 1-- joined'), 'x = 1 -- joined');
      assert.equal(line('x = --[[ a ]]1'), 'x = --[[ a ]] 1');
    });
  });

  describe('indentation', () => {
    it('indents the bodies of functions, loops, `do`, `if` clauses and `repeat`', () => {
      assert.deepEqual(
        format([
          'function f(a)',
          'for i = 1, a do',
          'if i then',
          'x()',
          'elseif a then',
          'y()',
          'else',
          'z()',
          'end',
          'end',
          'while a do',
          'do',
          'b()',
          'end',
          'end',
          'repeat',
          'c()',
          'until a',
          'end',
        ]),
        [
          'function f(a)',
          '  for i = 1, a do',
          '    if i then',
          '      x()',
          '    elseif a then',
          '      y()',
          '    else',
          '      z()',
          '    end',
          '  end',
          '  while a do',
          '    do',
          '      b()',
          '    end',
          '  end',
          '  repeat',
          '    c()',
          '  until a',
          'end',
        ],
      );
    });

    it('indents the contents of tables and multi-line call arguments', () => {
      assert.deepEqual(
        format(['local t = {', 'a = 1,', 'b = {', '2,', '},', '}', 'f(a,', 'b)']),
        ['local t = {', '  a = 1,', '  b = {', '    2,', '  },', '}', 'f(a,', '  b)'],
      );
    });

    it('indents once for several constructs opened on one line', () => {
      assert.deepEqual(
        format(['f(function()', 'x()', 'end)', 'g({', 'a = 1,', '}, {', 'b = 2,', '})']),
        ['f(function()', '  x()', 'end)', 'g({', '  a = 1,', '}, {', '  b = 2,', '})'],
      );
    });

    it('indents a line that continues a statement once more', () => {
      assert.deepEqual(
        format(['local x = a +', 'b', 'if a and', 'b then', 'c()', 'end', 'obj', ':m()']),
        ['local x = a +', '  b', 'if a and', '  b then', '  c()', 'end', 'obj', '  :m()'],
      );
    });

    it('indents `then` and `do` on their own line like their statement', () => {
      assert.deepEqual(
        format(['if a', 'then', 'b()', 'end', 'while a', 'do', 'b()', 'end']),
        ['if a', 'then', '  b()', 'end', 'while a', 'do', '  b()', 'end'],
      );
    });

    it('indents comment lines like the code around them', () => {
      assert.deepEqual(format(['do', '-- a', 'x()', '    -- b', 'end']), ['do', '  -- a', '  x()', '  -- b', 'end']);
    });

    it('indents with tabs, or with `tabSize` spaces per level', () => {
      assert.deepEqual(format(['do', 'do', 'x()', 'end', 'end'], { tabSize: 4, insertSpaces: false }), ['do', '\tdo', '\t\tx()', '\tend', 'end']);
      assert.deepEqual(format(['do', 'x()', 'end'], { tabSize: 4, insertSpaces: true }), ['do', '    x()', 'end']);
    });

    it('never changes the inside of long strings and long comments', () => {
      const lines = ['do', 'x = [[', '   keep  ', ']]', '--[==[', '  keep  ', ']==]', 'end'];
      assert.deepEqual(format(lines), ['do', '  x = [[', '   keep  ', ']]', '  --[==[', '  keep  ', ']==]', 'end']);
    });
  });

  describe('lines and white space', () => {
    it('removes trailing white space and empties blank lines, keeping every line', () => {
      assert.deepEqual(format(['x = 1   ', '   ', '\t', 'y = 2 -- c  ']), ['x = 1', '', '', 'y = 2 -- c']);
    });

    it('keeps CRLF and CR line breaks as written', () => {
      const text = 'do\r\nx = 1\ry = 2\r\nend\r\n';
      assert.equal(apply(text, edits(formatDocument(text, parseChunk(text), SPACES))), 'do\r\n  x = 1\r  y = 2\r\nend\r\n');
    });

    it('adds a final line break only when `insertFinalNewline` is set, with the line breaks of the text', () => {
      const run = (text: string, options: FormattingOptions): string => apply(text, edits(formatDocument(text, parseChunk(text), options)));
      assert.equal(run('x = 1  ', SPACES), 'x = 1');
      assert.equal(run('x = 1  ', { ...SPACES, insertFinalNewline: true }), 'x = 1\n');
      assert.equal(run('do\r\nend', { ...SPACES, insertFinalNewline: true }), 'do\r\nend\r\n');
      assert.equal(run('x = 1\n', { ...SPACES, insertFinalNewline: true }), 'x = 1\n');
    });

    it('removes the line breaks after the last one only when `trimFinalNewlines` is set', () => {
      const run = (text: string, options: FormattingOptions): string => apply(text, edits(formatDocument(text, parseChunk(text), options)));
      assert.equal(run('x = 1\n\n \n', SPACES), 'x = 1\n\n\n');
      assert.equal(run('x = 1\n\n \n', { ...SPACES, trimFinalNewlines: true }), 'x = 1\n');
      assert.equal(run('x = 1', { ...SPACES, trimFinalNewlines: true }), 'x = 1');
    });

    it('returns no edits for text that is already formatted', () => {
      const text = 'local t = { 1, 2 }\nfor i = 1, #t do\n  print(t[i])\nend\n';
      assert.deepEqual(edits(formatDocument(text, parseChunk(text), SPACES)), []);
    });

    it('returns edits that touch only white space, one line at a time', () => {
      const text = 'do\n   x=1   \n\n  \nend';
      for (const edit of edits(formatDocument(text, parseChunk(text), SPACES))) {
        assert.match(text.slice(edit.start, edit.end), /^[ \t]*$/);
        assert.doesNotMatch(edit.newText, /[\r\n]/);
      }
    });
  });

  describe('options', () => {
    it('refuses a tabSize outside VS Code\'s bounds (1 to 100) or not an integer, with insertSpaces only', () => {
      const text = 'do\nx()\nend';
      for (const tabSize of [0, 101, 2.5, Number.NaN, -1]) {
        assert.deepEqual(formatDocument(text, parseChunk(text), { tabSize, insertSpaces: true }), { ok: false, reason: 'invalid-options' }, String(tabSize));
        assert.deepEqual(formatRange(text, parseChunk(text), { tabSize, insertSpaces: true }, 0, 1), { ok: false, reason: 'invalid-options' }, String(tabSize));
      }
      assert.equal(apply(text, edits(formatDocument(text, parseChunk(text), { tabSize: 0, insertSpaces: false }))), 'do\n\tx()\nend');
      assert.equal(apply(text, edits(formatDocument(text, parseChunk(text), { tabSize: 100, insertSpaces: true }))).split('\n')[1]?.length, 103);
    });
  });

  describe('syntax errors', () => {
    it('refuses to format a document with any error', () => {
      for (const text of ['x = ', 'x = "open', 'do', 'x = 1 end']) {
        assert.deepEqual(formatDocument(text, parseChunk(text), SPACES), { ok: false, reason: 'syntax-error' });
      }
    });
  });

  describe('range formatting', () => {
    const text = ['do', 'a=1', 'b=2', 'c=3', 'end'].join('\n');
    const lineOffset = (n: number): number => text.split('\n').slice(0, n).join('\n').length + (n > 0 ? 1 : 0);

    it('formats only the lines the range touches', () => {
      const result = formatRange(text, parseChunk(text), SPACES, lineOffset(2) + 1, lineOffset(2) + 2);
      assert.equal(apply(text, edits(result)), ['do', 'a=1', '  b = 2', 'c=3', 'end'].join('\n'));
    });

    it('does not include a line where the range ends at its first character', () => {
      const result = formatRange(text, parseChunk(text), SPACES, lineOffset(1), lineOffset(3));
      assert.equal(apply(text, edits(result)), ['do', '  a = 1', '  b = 2', 'c=3', 'end'].join('\n'));
    });

    it('allows errors after the range, and refuses errors before its end', () => {
      const open = 'function f()\nx=1\ny=2';
      const firstLines = formatRange(open, parseChunk(open), SPACES, 0, 'function f()\nx'.length);
      assert.equal(apply(open, edits(firstLines)), 'function f()\n  x = 1\ny=2');
      // The `if` statement is abandoned at its `elseif`: its lines are still formatted with their own rules.
      const abandoned = 'if a then\nx=-a f{1} ::l:: goto l\nelseif';
      const inside = formatRange(abandoned, parseChunk(abandoned), SPACES, 'if a then\n'.length, 'if a then\nx'.length);
      assert.equal(apply(abandoned, edits(inside)), 'if a then\n  x = -a f{ 1 } ::l:: goto l\nelseif');
      const broken = 'x = = 1\ny=2';
      assert.deepEqual(formatRange(broken, parseChunk(broken), SPACES, broken.length - 1, broken.length), { ok: false, reason: 'syntax-error' });
    });
  });

  describe('on-type formatting', () => {
    it('formats the line a line break ended, keeping the indentation of a blank new line', () => {
      const text = 'function f()\nx=1\n    ';
      const result = formatOnType(text, parseChunk(text), SPACES, text.length, '\n');
      assert.equal(apply(text, edits(result)), 'function f()\n  x = 1\n    ');
    });

    it('indents a new line that has text after the cursor', () => {
      const inner = 'do\nx()\nend';
      const typed = formatOnType(inner, parseChunk(inner), SPACES, 'do\n'.length, '\n');
      assert.equal(apply(inner, edits(typed)), 'do\n  x()\nend');
    });

    it('re-indents a line when its first token, a closer, was just completed', () => {
      for (const [text, character] of [
        ['do\n  x()\n  end', 'd'],
        ['if a then\n  x()\n  else', 'e'],
        ['if a then\n  x()\n  elseif', 'f'],
        ['repeat\n  x()\n  until', 'l'],
        ['f(\n  a\n  )', ')'],
        ['t = {\n  a\n  }', '}'],
        ['t[\n  a\n  ]', ']'],
      ] as const) {
        const result = formatOnType(text, parseChunk(text), SPACES, text.length, character);
        const lines = apply(text, edits(result)).split('\n');
        assert.equal(lines.at(-1), lines.at(-1)?.trimStart(), `${JSON.stringify(text)} after ${character}`);
      }
    });

    it('does nothing for other characters, closers after other tokens, and partial keywords', () => {
      const cases: [string, string][] = [
        ['do\n  x()\n  en', 'n'],
        ['do\n  x() end', 'd'],
        ['do\n  x()\n  send', 'd'],
        ['  x = "end"', 'd'],
      ];
      for (const [text, character] of cases) {
        assert.deepEqual(formatOnType(text, parseChunk(text), SPACES, text.length, character), { ok: true, edits: [] }, text);
      }
    });

    it('refuses when the closer itself is an error', () => {
      const text = 'x()\n  end';
      assert.deepEqual(formatOnType(text, parseChunk(text), SPACES, text.length, 'd'), { ok: false, reason: 'syntax-error' });
    });
  });

  describe('properties', () => {
    let lua: Lua52Checker;
    before(async () => {
      lua = await loadLua52();
    });

    const fixtures = join(import.meta.dirname, '../../../fixtures/workspace');
    const SAMPLES: string[] = [
      ...readdirSync(fixtures)
        .filter((name) => name.endsWith('.lua'))
        .map((name) => readFileSync(join(fixtures, name), 'utf8')),
      `local t = { 1, 2; name = "n", [k .. "x"] = function(a, ...) return select('#', ...) end }
for i = #t, 1, -1 do
  if t[i] == nil then break elseif i % 2 == 0 then t[i] = i ^ 2 else t[i] = -i end
end`,
      `function M.obj:method(a, b)
local s = self.items[a] or {}
      while not s.done and b > 0 do s, b = s.next, b - 1 end
repeat local n = s:step() until n >= 10
  return s, (a .. b) ~= "x"
end`,
      'x=- - -1 local y=a- -b z=#t--c\n::l:: goto l',
      "s = 'a\\z\n     b' .. [==[\n  ]] ]==] --[[ x\n  ]] .. \"q\"",
      'f{a={b={c}}}(function() return function() end end)()',
      'local a =\n1\nlocal b = {\n[1] =\n2,\n}\nreturn a,\nb',
    ];

    it('never changes tokens or comments, and is idempotent', () => {
      for (const text of SAMPLES) {
        const tree = parseChunk(text);
        if (tree.errors.length > 0) continue;
        const once = apply(text, edits(formatDocument(text, tree, SPACES)));
        const strip = (s: string): string[] => {
          const { tokens, comments } = lex(s);
          return [...tokens.map((t) => `${t.type}:${t.value}`), ...comments.map((c) => s.slice(c.start, c.end).trimEnd())];
        };
        assert.deepEqual(strip(once), strip(text));
        assert.deepEqual(edits(formatDocument(once, parseChunk(once), SPACES)), [], `not idempotent:\n${once}`);
      }
    });

    it('formats code the official Lua 5.2 compiler accepts into code it accepts', () => {
      let checked = 0;
      for (const text of SAMPLES) {
        if (lua.check(text) !== undefined) continue;
        const once = apply(text, edits(formatDocument(text, parseChunk(text), SPACES)));
        assert.equal(lua.check(once), undefined, once);
        checked++;
      }
      assert.ok(checked >= 6, `only ${checked} samples compiled`);
    });
  });
});
