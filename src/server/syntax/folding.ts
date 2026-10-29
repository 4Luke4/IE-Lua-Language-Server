// Folding ranges (LSP `textDocument/foldingRange`). Pure: no LSP or `vscode`
// imports; src/server/features/foldingRanges.ts converts the result.
//
// Once a language server provides folding ranges, VS Code uses them instead of
// indentation and of the `folding.markers` of language-configuration/ie-menu.json,
// so every construct those covered is covered here too.
//
// Constructs fold from their first line to the line before their closing
// keyword, which stays visible (`end`, `until`, `}`, `)`, the next `elseif` /
// `else`, a closing `]]`, backtick or quote). A construct whose closing keyword
// is missing folds to its last line. Comments fold entirely.
//
// Lua: function bodies, `do`, `while`, `for`, `repeat`, each `if` / `elseif` /
// `else` clause, table constructors, parenthesized call arguments, long strings,
// long comments and runs of two or more `--` lines.
// .menu: every `{ … }` block, `` `…` `` blocks and `"…"` scripts, and the Lua
// constructs inside them.
// VS Code's built-in Lua configuration defines no region markers, so none are
// recognized here.

import type * as Ast from './ast.ts';
import type { ParsedDocument } from './document.ts';

export interface Fold {
  /** Zero-based lines, `startLine < endLine`. */
  readonly startLine: number;
  readonly endLine: number;
  readonly kind: 'comment' | undefined;
}

export function foldingRanges(document: ParsedDocument, text: string, lineAt: (offset: number) => number): Fold[] {
  const folds: Fold[] = [];

  /** From `start` to the line before `closeStart`; to the line of `end` when the closer is missing. */
  const fold = (start: number, closeStart: number | undefined, end: number): void => {
    const startLine = lineAt(start);
    const endLine = closeStart === undefined ? lineAt(end) : lineAt(closeStart) - 1;
    if (endLine > startLine) folds.push({ startLine, endLine, kind: undefined });
  };

  const comment = (start: number, end: number): void => {
    const startLine = lineAt(start);
    const endLine = lineAt(end);
    if (endLine > startLine) folds.push({ startLine, endLine, kind: 'comment' });
  };

  /** Only blanks between the start of its line and `offset`. */
  const startsLine = (offset: number): boolean => {
    let i = offset - 1;
    while (i >= 0 && (text[i] === ' ' || text[i] === '\t')) i--;
    return i < 0 || text[i] === '\n' || text[i] === '\r';
  };

  const block = (node: Ast.Block): void => {
    for (const statement of node.body) visitStatement(statement);
  };

  const expressions = (nodes: readonly (Ast.Expression | undefined)[]): void => {
    for (const node of nodes) if (node) visitExpression(node);
  };

  function func(node: Ast.FunctionExpression): void {
    fold(node.start, node.closeStart, node.end);
    block(node.body);
  }

  function visitStatement(node: Ast.Statement): void {
    switch (node.kind) {
      case 'LocalStatement':
        expressions(node.values);
        break;
      case 'AssignmentStatement':
        expressions(node.targets);
        expressions(node.values);
        break;
      case 'CallStatement':
        visitExpression(node.call);
        break;
      case 'DoStatement':
        fold(node.start, node.closeStart, node.end);
        block(node.body);
        break;
      case 'WhileStatement':
        fold(node.start, node.closeStart, node.end);
        visitExpression(node.condition);
        block(node.body);
        break;
      case 'RepeatStatement':
        fold(node.start, node.closeStart, node.end);
        block(node.body);
        expressions([node.condition]);
        break;
      case 'IfStatement':
        node.clauses.forEach((clause, index) => {
          fold(clause.start, node.clauses[index + 1]?.start ?? node.closeStart, clause.end);
          expressions([clause.condition]);
          block(clause.body);
        });
        break;
      case 'NumericForStatement':
        fold(node.start, node.closeStart, node.end);
        expressions([node.initial, node.limit, node.step]);
        block(node.body);
        break;
      case 'GenericForStatement':
        fold(node.start, node.closeStart, node.end);
        expressions(node.iterators);
        block(node.body);
        break;
      case 'FunctionDeclaration':
      case 'LocalFunctionStatement':
        func(node.func);
        break;
      case 'ReturnStatement':
        expressions(node.values);
        break;
      case 'BreakStatement':
      case 'GotoStatement':
      case 'LabelStatement':
        break;
    }
  }

  function visitExpression(node: Ast.Expression): void {
    switch (node.kind) {
      case 'FunctionExpression':
        func(node);
        break;
      case 'TableConstructor':
        fold(node.start, node.closeStart, node.end);
        for (const field of node.fields) expressions([field.form === 'keyed' ? field.key : undefined, field.value]);
        break;
      case 'StringLiteral':
        // A long string keeps its closing bracket line visible.
        if (node.raw.startsWith('[')) fold(node.start, node.end, node.end);
        break;
      case 'BinaryExpression':
        expressions([node.left, node.right]);
        break;
      case 'UnaryExpression':
        visitExpression(node.argument);
        break;
      case 'ParenthesizedExpression':
        visitExpression(node.expression);
        break;
      case 'MemberExpression':
        visitExpression(node.base);
        break;
      case 'IndexExpression':
        expressions([node.base, node.index]);
        break;
      case 'CallExpression':
      case 'MethodCallExpression':
        visitExpression(node.base);
        if (node.arguments.form === 'parentheses') fold(node.arguments.start, node.arguments.closeStart, node.end);
        expressions(node.arguments.values);
        break;
      default:
        break;
    }
  }

  for (const { chunk, tree } of document.chunks) {
    const { region } = chunk;
    if (region.start < chunk.offset) {
      // From the opening backtick or quote to the closing one.
      fold(region.start, region.end - 1, region.end - 1);
    }
    block(tree.body);
    // Runs of `--` comments that each start their own, consecutive line.
    let run: { startLine: number; endLine: number } | undefined;
    const endRun = (): void => {
      if (run && run.endLine > run.startLine) folds.push({ ...run, kind: 'comment' });
      run = undefined;
    };
    for (const c of tree.comments) {
      if (c.long) {
        endRun();
        comment(c.start, c.end);
      } else if (startsLine(c.start)) {
        const line = lineAt(c.start);
        if (run?.endLine === line - 1) {
          run.endLine = line;
        } else {
          endRun();
          run = { startLine: line, endLine: line };
        }
      } else {
        endRun();
      }
    }
    endRun();
  }

  const menuBlocks = (blocks: ParsedDocument['blocks']): void => {
    for (const b of blocks) {
      fold(b.keyword?.start ?? b.open, b.close, text.length);
      menuBlocks(b.children);
    }
  };
  menuBlocks(document.blocks);

  // A line has one fold toggle, so keep one range per start line: the outermost.
  const byStart = new Map<number, Fold>();
  for (const f of folds) {
    const existing = byStart.get(f.startLine);
    if (!existing || f.endLine > existing.endLine) byStart.set(f.startLine, f);
  }
  return [...byStart.values()].sort((a, b) => a.startLine - b.startLine);
}
