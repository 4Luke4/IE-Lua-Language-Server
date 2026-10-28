// Same-document rename of a variable. Pure: no LSP or `vscode` imports.
//
// A rename is refused, rather than producing code that behaves differently,
// when:
// - the cursor is not on a variable name, or is on the implicit `self`;
// - the variable is a global the document never assigns: it is defined
//   elsewhere (another file, the game, EEex), which a same-file rename cannot
//   update;
// - the code where it can occur has syntax errors (its chunk for a local, any
//   chunk for a global): error recovery skips tokens, so some uses would be
//   missed;
// - the new name is not a Lua name, or is a reserved word;
// - the new name would change what any name refers to: an inner local capturing
//   a renamed use, the renamed local hiding an outer variable used in its scope,
//   or two globals merging. This is decided by re-analyzing the renamed text,
//   not by heuristics (see `checkBindings`).

import type { RenameRefusal } from '../../shared/protocol.ts';
import type * as Ast from './ast.ts';
import { parseDocument, type ParsedDocument } from './document.ts';
import { lex } from './lexer.ts';
import { definitions, references, targetAt, variableIndex, type NavigationTarget, type VariableOccurrence } from './navigation.ts';

export type RenameOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: RenameRefusal };

export interface RenameEdit {
  readonly start: number;
  readonly end: number;
  readonly newText: string;
}

const refuse = (refusal: RenameRefusal): { ok: false; refusal: RenameRefusal } => ({ ok: false, refusal });

/** The renameable variable at `offset`, as found by `targetAt`. */
function renameTarget(document: ParsedDocument, offset: number): RenameOutcome<{ target: NavigationTarget; identifier: Ast.Identifier }> {
  const hit = targetAt(document, offset);
  if (!hit) {
    return refuse('notAVariable');
  }
  if (hit.target.kind === 'local' && hit.target.declaration.kind === 'self') {
    return refuse('implicitSelf');
  }
  if (hit.target.kind === 'global' && definitions(document, hit.target).length === 0) {
    return refuse('globalNotDefinedHere');
  }
  const searched = hit.target.kind === 'local' ? [document.chunks[hit.target.chunkIndex]] : document.chunks;
  if (searched.some((chunk) => chunk && chunk.tree.errors.length > 0)) {
    return refuse('syntaxErrors');
  }
  return { ok: true, value: hit };
}

/** `textDocument/prepareRename`: the identifier that would be renamed. */
export function prepareRename(document: ParsedDocument, offset: number): RenameOutcome<Ast.Identifier> {
  const found = renameTarget(document, offset);
  return found.ok ? { ok: true, value: found.value.identifier } : found;
}

/** Whether `name` is a Lua 5.2 name, using the lexer's own rule. */
function nameRefusal(name: string): RenameRefusal | undefined {
  const { tokens, errors } = lex(name);
  const [token, eof] = tokens;
  if (errors.length === 0 && tokens.length === 2 && token?.start === 0 && token.end === name.length && eof?.type === 'eof') {
    if (token.type === 'keyword') return 'reservedWord';
    if (token.type === 'name') return undefined;
  }
  return 'invalidName';
}

/** What an identifier refers to: a declaration (by chunk and position), or a global by name. */
function bindingKeys(document: ParsedDocument): Map<VariableOccurrence, string> {
  const keys = new Map<VariableOccurrence, string>();
  const declarationIndexes = document.chunks.map(({ scopes }) => new Map(scopes.declarations.map((d, i) => [d, i])));
  for (const occurrence of variableIndex(document)) {
    const { identifier, chunkIndex } = occurrence;
    const declaration = document.chunks[chunkIndex]?.scopes.resolved.get(identifier);
    const index = declaration && declarationIndexes[chunkIndex]?.get(declaration);
    keys.set(occurrence, index === undefined ? `global ${identifier.name}` : `local ${String(chunkIndex)}:${String(index)}`);
  }
  return keys;
}

/**
 * Whether every identifier of `renamed` refers to what it referred to in
 * `original`: renamed identifiers to the same local, or to the global under its
 * new name; every other identifier to exactly the same thing.
 */
function checkBindings(original: ParsedDocument, renamed: ParsedDocument, edits: readonly RenameEdit[], oldName: string, newName: string): boolean {
  const before = bindingKeys(original);
  const after = bindingKeys(renamed);
  if (before.size !== after.size) {
    return false;
  }
  const delta = newName.length - oldName.length;
  const editStarts = new Set(edits.map((edit) => edit.start));
  const afterByOffset = new Map([...after].map(([occurrence, key]) => [occurrence.identifier.start, key]));
  let shift = 0;
  for (const [occurrence, key] of before) {
    // Occurrences are in offset order, so `shift` counts the edits before this one.
    const start = occurrence.identifier.start;
    const isRenamed = editStarts.has(start);
    const expected = isRenamed && key.startsWith('global ') ? `global ${newName}` : key;
    if (afterByOffset.get(start + shift) !== expected) {
      return false;
    }
    if (isRenamed) shift += delta;
  }
  return true;
}

/**
 * `textDocument/rename`: the edits renaming the variable at `offset` to
 * `newName` everywhere in the document. `text` is the document text that
 * `document` was parsed from.
 */
export function rename(document: ParsedDocument, text: string, offset: number, newName: string): RenameOutcome<RenameEdit[]> {
  const found = renameTarget(document, offset);
  if (!found.ok) {
    return found;
  }
  const refusal = nameRefusal(newName);
  if (refusal) {
    return refuse(refusal);
  }
  const { target, identifier } = found.value;
  const oldName = identifier.name;
  if (newName === oldName) {
    return { ok: true, value: [] };
  }
  // Two globals would become one; the binding check cannot see that, since both keep a global binding.
  if (target.kind === 'global' && document.chunks.some(({ scopes }) => scopes.globals.has(newName))) {
    return refuse('conflict');
  }
  const edits = references(document, target, true).map(({ start, end }) => ({ start, end, newText: newName }));
  let renamedText = '';
  let last = 0;
  for (const edit of edits) {
    renamedText += text.slice(last, edit.start) + edit.newText;
    last = edit.end;
  }
  renamedText += text.slice(last);
  const renamed = parseDocument(renamedText, document.kind);
  return checkBindings(document, renamed, edits, oldName, newName) ? { ok: true, value: edits } : refuse('conflict');
}
