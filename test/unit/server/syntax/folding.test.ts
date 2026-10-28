import assert from 'node:assert/strict';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseDocument } from '../../../../src/server/syntax/document.ts';
import { foldingRanges } from '../../../../src/server/syntax/folding.ts';

/** `start-end` (or `start-end comment`) per range; lines as LSP counts them. */
function folds(lines: readonly string[], kind: 'lua' | 'menu' = 'lua'): string[] {
  const text = lines.join('\n');
  const document = TextDocument.create('file:///x', kind === 'lua' ? 'lua' : 'ie-menu', 1, text);
  return foldingRanges(parseDocument(text, kind), text, (offset) => document.positionAt(offset).line).map(
    (f) => `${f.startLine}-${f.endLine}${f.kind ? ` ${f.kind}` : ''}`,
  );
}

describe('server/syntax/folding', () => {
  it('folds function bodies and loops, keeping the closing line visible', () => {
    assert.deepEqual(
      folds([
        'function f()', //       0
        '  for i = 1, 2 do', //  1
        '    x()', //            2
        '  end', //              3
        'end', //                4
        'while a do', //         5
        '  b()', //              6
        'end', //                7
        'repeat', //             8
        '  c()', //              9
        'until d', //            10
      ]),
      ['0-3', '1-2', '5-6', '8-9'],
    );
  });

  it('folds each clause of an if statement separately', () => {
    assert.deepEqual(folds(['if a then', '  x()', 'elseif b then', '  y()', 'else', '  z()', 'end']), ['0-1', '2-3', '4-5']);
  });

  it('folds multi-line tables, call arguments and long strings', () => {
    assert.deepEqual(
      folds([
        'local t = {', //     0
        '  a = 1,', //        1
        '}', //               2
        'print(', //          3
        '  t,', //            4
        '  [[long', //        5
        '  string', //        6
        '  ]]', //            7
        ')', //               8
      ]),
      ['0-1', '3-7', '5-6'],
    );
  });

  it('does not fold constructs on a single line or on two lines', () => {
    assert.deepEqual(folds(['function f() return 1 end', 'do x() end', 'if a then', 'end']), []);
  });

  it('folds whole long comments and runs of line comments', () => {
    assert.deepEqual(
      folds([
        '--[[', //            0
        'block', //           1
        ']]', //              2
        '-- one', //          3
        '-- two', //          4
        '   -- three', //     5
        'x = 1 -- trailing', //  6
        '-- alone', //        7
        'y = 2', //           8
      ]),
      ['0-2 comment', '3-5 comment'],
    );
  });

  it('folds to the last line when the closing keyword is missing', () => {
    assert.deepEqual(folds(['function f()', '  x()', '  y()']), ['0-2']);
  });

  it('keeps the outermost range when several start on the same line', () => {
    assert.deepEqual(folds(['f(function()', '  x()', 'end)']), ['0-1']);
  });

  it('folds .menu blocks, backtick blocks, scripts and the Lua inside them', () => {
    assert.deepEqual(
      folds(
        [
          '`', //                       0
          'function f()', //            1
          '  x()', //                   2
          'end', //                     3
          '`', //                       4
          'menu', //                    5
          '{', //                       6
          "\tname 'M'", //              7
          '\tbutton', //                8
          '\t{', //                     9
          '\t\taction', //              10
          '\t\t"', //                   11
          '\t\t\tif a then', //         12
          '\t\t\t\tb()', //             13
          '\t\t\tend', //               14
          '\t\t"', //                   15
          '\t}', //                     16
          '}', //                       17
        ],
        'menu',
      ),
      ['0-3', '1-2', '5-16', '8-15', '11-14', '12-13'],
    );
  });
});
