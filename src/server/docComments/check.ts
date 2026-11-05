// Problems in LuaCATS doc comments. Pure: no LSP or `vscode` imports.
//
// Only what can be told from the text, never from types (which are shown as
// written and never checked):
//
// - `doc-tag-malformed`: `---@param` without a name or type, `---@return` or
//   `---@type` without a type (the annotation reference requires them). In any
//   doc block.
// - `doc-param-unknown`: `---@param x` above a function the parser sees
//   (attach.ts) that has no parameter `x`: `...` needs a vararg function, `self`
//   is the implicit parameter of a method. A block above anything else (a call
//   result could be any function) is not checked.
// - `doc-param-duplicate`: a parameter documented twice in one block.

import type { Messages } from '../l10n.ts';
import type { ParsedDocument } from '../syntax/document.ts';
import { DiagnosticCode, type Problem } from '../validation/types.ts';
import { documentDocs, type DocBlock } from './attach.ts';
import type { MalformedTag } from './parse.ts';

function malformedMessage({ tag, reason }: MalformedTag, messages: Messages): string {
  switch (reason) {
    case 'paramName':
      return messages.t('doc.paramNameMissing', tag);
    case 'paramType':
      return messages.t('doc.paramTypeMissing', tag);
    case 'type':
      return messages.t('doc.typeMissing', tag);
  }
}

/** The parameter names `block`'s function accepts, or `undefined` when it has no function. */
function acceptedNames(block: DocBlock): ReadonlySet<string> | undefined {
  if (!block.func) return undefined;
  const names = new Set(block.func.parameters.map((parameter) => parameter.name));
  if (block.func.isVararg) names.add('...');
  if (block.method) names.add('self');
  return names;
}

/** The doc-comment problems of `document`, in source order. */
export function checkDocComments(document: ParsedDocument, messages: Messages): Problem[] {
  const problems: Problem[] = [];
  for (const block of documentDocs(document).blocks) {
    const found: { readonly start: number; readonly problem: Problem }[] = [];
    for (const malformed of block.doc.malformed) {
      found.push({
        start: malformed.span.start,
        problem: { ...malformed.span, code: DiagnosticCode.DocTagMalformed, severity: 'warning', message: malformedMessage(malformed, messages) },
      });
    }
    const accepted = acceptedNames(block);
    const seen = new Set<string>();
    for (const { name, nameSpan } of block.doc.params) {
      const quoted = JSON.stringify(name);
      if (seen.has(name)) {
        found.push({ start: nameSpan.start, problem: { ...nameSpan, code: DiagnosticCode.DocParamDuplicate, severity: 'warning', message: messages.t('doc.paramDuplicate', quoted) } });
      } else if (accepted && !accepted.has(name)) {
        found.push({ start: nameSpan.start, problem: { ...nameSpan, code: DiagnosticCode.DocParamUnknown, severity: 'warning', message: messages.t('doc.paramUnknown', quoted) } });
      }
      seen.add(name);
    }
    found.sort((a, b) => a.start - b.start);
    problems.push(...found.map(({ problem }) => problem));
  }
  return problems;
}
