import assert from 'node:assert/strict';
import { LSPErrorCodes } from 'vscode-languageserver/node';
import { refusalError, toWorkspaceEdit } from '../../../../src/server/features/rename.ts';
import { RENAME_REFUSAL_MESSAGES, type RenameRefusal } from '../../../../src/shared/protocol.ts';

describe('server/features/rename', () => {
  const edits = [{ range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } }, newText: 'b' }];

  it('sends versioned document changes to clients that support them', () => {
    assert.deepEqual(toWorkspaceEdit({ uri: 'file:///a.lua', version: 4 }, edits, true), {
      documentChanges: [{ textDocument: { uri: 'file:///a.lua', version: 4 }, edits }],
    });
  });

  it('sends plain changes to other clients', () => {
    assert.deepEqual(toWorkspaceEdit({ uri: 'file:///a.lua', version: 4 }, edits, false), { changes: { 'file:///a.lua': edits } });
  });

  it('refuses with RequestFailed and the fixed English message of the reason', () => {
    for (const reason of Object.keys(RENAME_REFUSAL_MESSAGES) as RenameRefusal[]) {
      const error = refusalError(reason);
      assert.equal(error.code, LSPErrorCodes.RequestFailed);
      assert.equal(error.message, RENAME_REFUSAL_MESSAGES[reason]);
    }
  });

  it('has a distinct message per reason, so the client can tell them apart', () => {
    const messages = Object.values(RENAME_REFUSAL_MESSAGES);
    assert.equal(new Set(messages).size, messages.length);
  });
});
