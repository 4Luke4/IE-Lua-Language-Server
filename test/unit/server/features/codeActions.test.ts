import assert from 'node:assert/strict';
import { CodeActionKind, type CodeAction, type Diagnostic } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { codeActions, CODE_ACTION_KINDS, supportsCodeActionLiterals, wanted, type CodeActionDeps } from '../../../../src/server/features/codeActions.ts';
import { createMessages } from '../../../../src/server/l10n.ts';
import { DIAGNOSTIC_SOURCE, FIX_ALL_KIND } from '../../../../src/shared/protocol.ts';

const deps: CodeActionDeps = { messages: createMessages(undefined), documentChanges: false };

function menu(text: string, version = 1): TextDocument {
  return TextDocument.create('file:///w/UI.MENU', 'ie-menu', version, text);
}

/** The diagnostic the server publishes for `[start, end)` of `document`. */
function diagnostic(document: TextDocument, start: number, end: number, code: string, source = DIAGNOSTIC_SOURCE): Diagnostic {
  return { range: { start: document.positionAt(start), end: document.positionAt(end) }, code, source, message: '' };
}

/** `title → new text of each edit` of each action. */
function summary(actions: CodeAction[]): string[] {
  return actions.map((action) => {
    const edits = Object.values(action.edit?.changes ?? {}).flat();
    return `${action.title} [${String(action.kind)}] ${edits.map((edit) => JSON.stringify(edit.newText)).join(' ')}`;
  });
}

describe('server/features/codeActions', () => {
  it('advertises quick fixes and the IE Lua fix-all kind, only to clients that accept CodeAction literals', () => {
    assert.deepEqual([...CODE_ACTION_KINDS], ['quickfix', 'source.fixAll.ieLua']);
    assert.equal(FIX_ALL_KIND, 'source.fixAll.ieLua');
    assert.equal(supportsCodeActionLiterals({ codeActionKind: { valueSet: [] } }), true);
    assert.equal(supportsCodeActionLiterals(undefined), false);
  });

  it('filters by kind as LSP does: a requested kind includes its sub-kinds', () => {
    assert.equal(wanted(CodeActionKind.QuickFix, undefined), true);
    assert.equal(wanted(FIX_ALL_KIND, undefined), false);
    for (const only of [['source'], ['source.fixAll'], [FIX_ALL_KIND]]) {
      assert.equal(wanted(FIX_ALL_KIND, only), true, only.join());
      assert.equal(wanted(CodeActionKind.QuickFix, only), false, only.join());
    }
    assert.equal(wanted(FIX_ALL_KIND, ['source.fix']), false);
    assert.equal(wanted(FIX_ALL_KIND, ['source.organizeImports']), false);
    assert.equal(wanted(CodeActionKind.QuickFix, ['quickfix']), true);
  });

  it('offers the fix of a published diagnostic, preferred and linked to it', () => {
    const document = menu('name My_Menu');
    const published = diagnostic(document, 5, 12, 'menu-unquoted-underscore');
    const { actions, refused } = codeActions(document, { context: { diagnostics: [published] } }, deps);
    assert.deepEqual(refused, []);
    assert.deepEqual(summary(actions), ['Enclose in quotes [quickfix] "\\"My_Menu\\""']);
    const [action] = actions;
    assert.ok(action);
    assert.equal(action.isPreferred, true);
    assert.deepEqual(action.diagnostics, [published]);
  });

  it('inserts a space before a closing backtick', () => {
    const document = menu('`x = 1`');
    const { actions } = codeActions(document, { context: { diagnostics: [diagnostic(document, 5, 6, 'menu-inline-lua-last-character')] } }, deps);
    assert.deepEqual(summary(actions), ['Insert a space before the closing backtick [quickfix] " "']);
  });

  it('adds a fix for every problem of the code when there are several, once', () => {
    const document = menu('a_b c_d');
    const both = [diagnostic(document, 0, 3, 'menu-unquoted-underscore'), diagnostic(document, 4, 7, 'menu-unquoted-underscore')];
    const { actions } = codeActions(document, { context: { diagnostics: both } }, deps);
    assert.deepEqual(summary(actions), [
      'Enclose in quotes [quickfix] "\\"a_b\\""',
      'Fix all menu-unquoted-underscore problems [quickfix] "\\"a_b\\"" "\\"c_d\\""',
      'Enclose in quotes [quickfix] "\\"c_d\\""',
    ]);
  });

  it('ignores diagnostics that are stale, from another source or without a fix', () => {
    const document = menu('  name My_Menu "open');
    const diagnostics = [
      // Published before two spaces were typed at the start.
      diagnostic(document, 5, 12, 'menu-unquoted-underscore'),
      diagnostic(document, 7, 14, 'menu-unquoted-underscore', 'other linter'),
      diagnostic(document, 15, 16, 'menu-unterminated-string'),
      diagnostic(document, 0, 1, 'lua-syntax'),
    ];
    assert.deepEqual(codeActions(document, { context: { diagnostics } }, deps).actions, []);
  });

  it('fixes every fixable problem with source.fixAll.ieLua, whether or not diagnostics were published', () => {
    const document = menu('name My_Menu\narea 10_0 0 1 1\n`x = 1`');
    for (const only of [['source'], ['source.fixAll'], [FIX_ALL_KIND]]) {
      const { actions } = codeActions(document, { context: { diagnostics: [], only } }, deps);
      assert.deepEqual(summary(actions), ['Fix all IE Lua auto-fixable problems [source.fixAll.ieLua] "\\"My_Menu\\"" " "'], only.join());
    }
  });

  it('returns no fix-all action when nothing can be fixed', () => {
    const document = menu('area 10_0 0 1 1');
    assert.deepEqual(codeActions(document, { context: { diagnostics: [], only: ['source'] } }, deps).actions, []);
  });

  it('returns no quick fixes when only source actions are requested, and no source action otherwise', () => {
    const document = menu('name My_Menu');
    const published = [diagnostic(document, 5, 12, 'menu-unquoted-underscore')];
    assert.deepEqual(summary(codeActions(document, { context: { diagnostics: published, only: ['source'] } }, deps).actions), [
      'Fix all IE Lua auto-fixable problems [source.fixAll.ieLua] "\\"My_Menu\\""',
    ]);
    assert.deepEqual(summary(codeActions(document, { context: { diagnostics: published } }, deps).actions), ['Enclose in quotes [quickfix] "\\"My_Menu\\""']);
  });

  it('offers nothing for Lua files', () => {
    const document = TextDocument.create('file:///w/a.lua', 'lua', 1, 'local My_Menu = 1');
    assert.deepEqual(codeActions(document, { context: { diagnostics: [], only: ['source', 'quickfix'] } }, deps).actions, []);
  });

  it('sends versioned edits to clients that support documentChanges', () => {
    const document = menu('name My_Menu', 7);
    const { actions } = codeActions(document, { context: { diagnostics: [], only: [FIX_ALL_KIND] } }, { ...deps, documentChanges: true });
    assert.deepEqual(actions[0]?.edit, {
      documentChanges: [
        {
          textDocument: { uri: 'file:///w/UI.MENU', version: 7 },
          edits: [{ range: { start: { line: 0, character: 5 }, end: { line: 0, character: 12 } }, newText: '"My_Menu"' }],
        },
      ],
    });
  });

  it('titles the actions in the client locale', () => {
    const document = menu('name My_Menu');
    const german = { ...deps, messages: createMessages('de') };
    const { actions } = codeActions(document, { context: { diagnostics: [diagnostic(document, 5, 12, 'menu-unquoted-underscore')] } }, german);
    assert.equal(actions[0]?.title, 'In Anführungszeichen setzen');
  });
});
