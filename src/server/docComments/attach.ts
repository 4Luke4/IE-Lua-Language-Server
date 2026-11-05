// Which code a LuaCATS doc block documents. Pure: no LSP or `vscode` imports.
//
// The annotation reference does not state where a doc block must be; all its
// examples put it on the lines directly above the code. That is the rule here:
//
// - A doc line is a `--` short comment that starts with exactly three dashes
//   (`---`, not `----` banners) and is alone on its line (only white space
//   before it). A `---` comment after code is not a doc comment.
// - A doc block is a run of doc lines on consecutive lines.
// - It documents the statement that starts on the next line (white space before
//   it is fine). A blank line, or anything else, in between detaches it.
//
// Documented names are those hover describes by their declaration
// (signatures.ts): `local function f`, `local x = …` with one name,
// `function G()` with one name and `G = …` with one target. Parameters take their
// `@param` entry from a block above any statement whose function the parser
// sees, which also includes `function M.f(a)`, `function M:m(a)` and
// `M.f = function(a) … end`.

import type * as Ast from '../syntax/ast.ts';
import type { ParsedDocument } from '../syntax/document.ts';
import { walk } from '../syntax/walk.ts';
import { parseDocComment, type DocComment, type DocLine, type DocParam } from './parse.ts';

export interface DocBlock {
  readonly doc: DocComment;
  /** From the first `---` to the end of the last doc line. */
  readonly start: number;
  readonly end: number;
  /** The statement the block documents, if one starts on the next line. */
  readonly statement: Ast.Statement | undefined;
  /** The function that statement defines, when the parser sees it. */
  readonly func: Ast.FunctionExpression | undefined;
  /** The function is a method (`function M:m()`), with an implicit `self`. */
  readonly method: boolean;
}

export interface DocumentDocs {
  /** Every doc block of the document, in source order. */
  readonly blocks: readonly DocBlock[];
  /** The doc comment of each documented declaring or assigned identifier. */
  readonly names: ReadonlyMap<Ast.Identifier, DocComment>;
  /** The `@param` entry of each documented parameter (the first, when one is documented twice). */
  readonly parameters: ReadonlyMap<Ast.Identifier, DocParam>;
}

/** `\r\n`, `\n` or `\r` and then only white space: the next line, with no blank line in between. */
const NEXT_LINE = /^(?:\r\n|\n|\r)[ \t\v\f]*$/;
/** The same at `lastIndex` (sticky): where the next line's first non-blank character is. */
const NEXT_LINE_AT = /(?:\r\n|\n|\r)[ \t\v\f]*/y;
const LINE_INDENT = /(?:^|[\r\n])[ \t\v\f]*$/;

/** Whether only white space precedes `offset` on its line. */
const aloneOnLine = (text: string, offset: number): boolean => LINE_INDENT.test(text.slice(Math.max(0, text.lastIndexOf('\n', offset - 1), text.lastIndexOf('\r', offset - 1)), offset));

const isDocLine = (text: string, comment: { readonly start: number; readonly end: number; readonly long: boolean }): boolean =>
  !comment.long && text.startsWith('---', comment.start) && text[comment.start + 3] !== '-' && aloneOnLine(text, comment.start);

/** The function a statement defines, if it is written there. */
function definedFunction(statement: Ast.Statement): { readonly func: Ast.FunctionExpression | undefined; readonly method: boolean } {
  switch (statement.kind) {
    case 'LocalFunctionStatement':
      return { func: statement.func, method: false };
    case 'FunctionDeclaration':
      return { func: statement.func, method: statement.method !== undefined };
    case 'LocalStatement':
    case 'AssignmentStatement': {
      const [value] = statement.values;
      const count = statement.kind === 'LocalStatement' ? statement.names.length : statement.targets.length;
      return { func: count === 1 && statement.values.length === 1 && value?.kind === 'FunctionExpression' ? value : undefined, method: false };
    }
    default:
      return { func: undefined, method: false };
  }
}

/** The identifier a statement documents for hover, if any. */
function documentedName(statement: Ast.Statement): Ast.Identifier | undefined {
  switch (statement.kind) {
    case 'LocalFunctionStatement':
      return statement.name;
    case 'LocalStatement':
      return statement.names.length === 1 ? statement.names[0] : undefined;
    case 'FunctionDeclaration':
      return statement.path.length === 1 && statement.method === undefined ? statement.path[0] : undefined;
    case 'AssignmentStatement': {
      const [target] = statement.targets;
      return statement.targets.length === 1 && target?.kind === 'Identifier' ? target : undefined;
    }
    default:
      return undefined;
  }
}

function analyze(document: ParsedDocument): DocumentDocs {
  const { text } = document;
  const blocks: DocBlock[] = [];
  const names = new Map<Ast.Identifier, DocComment>();
  const parameters = new Map<Ast.Identifier, DocParam>();
  for (const { tree } of document.chunks) {
    // Runs of doc lines on consecutive lines.
    const runs: { start: number; end: number; lines: DocLine[] }[] = [];
    for (const comment of tree.comments) {
      if (!isDocLine(text, comment)) continue;
      const line: DocLine = { text: text.slice(comment.start + 3, comment.end), start: comment.start + 3 };
      const last = runs[runs.length - 1];
      if (last && NEXT_LINE.test(text.slice(last.end, comment.start))) {
        last.lines.push(line);
        last.end = comment.end;
      } else {
        runs.push({ start: comment.start, end: comment.end, lines: [line] });
      }
    }
    if (runs.length === 0) continue;
    // Statements by the offset of their first token; the outermost one when several start there.
    const statements = new Map<number, Ast.Statement>();
    walk(tree.body, (node) => {
      if (isStatement(node) && !statements.has(node.start)) statements.set(node.start, node);
    });
    for (const run of runs) {
      const doc = parseDocComment(run.lines);
      // The statement after one line break and indentation, if one starts there.
      NEXT_LINE_AT.lastIndex = run.end;
      const next = NEXT_LINE_AT.exec(text);
      const statement = next ? statements.get(NEXT_LINE_AT.lastIndex) : undefined;
      const { func, method } = statement ? definedFunction(statement) : { func: undefined, method: false };
      blocks.push({ doc, start: run.start, end: run.end, statement, func, method });
      if (!statement) continue;
      const name = documentedName(statement);
      if (name) names.set(name, doc);
      for (const parameter of func?.parameters ?? []) {
        const entry = doc.params.find((param) => param.name === parameter.name);
        if (entry) parameters.set(parameter, entry);
      }
    }
  }
  return { blocks, names, parameters };
}

const STATEMENT_KINDS: ReadonlySet<string> = new Set<Ast.Statement['kind']>([
  'LocalStatement', 'AssignmentStatement', 'CallStatement', 'DoStatement', 'WhileStatement', 'RepeatStatement',
  'IfStatement', 'NumericForStatement', 'GenericForStatement', 'FunctionDeclaration', 'LocalFunctionStatement',
  'ReturnStatement', 'BreakStatement', 'GotoStatement', 'LabelStatement',
]);

const isStatement = (node: Ast.Statement | Ast.Expression): node is Ast.Statement => STATEMENT_KINDS.has(node.kind);

/** Doc blocks of each document; dropped with the document. */
const indexes = new WeakMap<ParsedDocument, DocumentDocs>();

/** The doc blocks of `document` and what they document, computed once per parsed document. */
export function documentDocs(document: ParsedDocument): DocumentDocs {
  let docs = indexes.get(document);
  if (!docs) {
    docs = analyze(document);
    indexes.set(document, docs);
  }
  return docs;
}

/** The doc comment of a declaring or assigned identifier (`local function f`, `G = …`), if it has one. */
export function docCommentFor(document: ParsedDocument, identifier: Ast.Identifier): DocComment | undefined {
  return documentDocs(document).names.get(identifier);
}

/** The `@param` entry of a declared parameter, if its function's doc block has one. */
export function parameterDoc(document: ParsedDocument, parameter: Ast.Identifier): DocParam | undefined {
  return documentDocs(document).parameters.get(parameter);
}
