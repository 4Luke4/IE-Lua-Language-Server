import * as vscode from 'vscode';
import type { Middleware } from 'vscode-languageclient/node';
import { RENAME_REFUSAL_MESSAGES, type RenameRefusal } from '../shared/protocol.ts';

/**
 * The display-language message of a refusal. The keys must equal
 * RENAME_REFUSAL_MESSAGES: test/unit/shared/protocol.test.ts checks the exported
 * l10n bundle, and `npm run check-l10n` that the bundle matches these calls.
 */
function localized(reason: RenameRefusal): string {
  switch (reason) {
    case 'notAVariable':
      return vscode.l10n.t('Only the names of local and global variables can be renamed.');
    case 'implicitSelf':
      return vscode.l10n.t('The implicit "self" of a method has no declaration and cannot be renamed.');
    case 'globalNotDefinedHere':
      return vscode.l10n.t(
        'This global is never assigned in this file. It is defined elsewhere (another file, the game or EEex), so it cannot be renamed here.',
      );
    case 'syntaxErrors':
      return vscode.l10n.t('Fix the syntax errors first: names in code that does not parse cannot all be found.');
    case 'invalidName':
      return vscode.l10n.t('The new name is not a valid Lua name: use letters, digits and underscores, and do not start with a digit.');
    case 'reservedWord':
      return vscode.l10n.t('The new name is a reserved word in Lua.');
    case 'conflict':
      return vscode.l10n.t('Renaming would change what another name in this file refers to.');
  }
}

const REASONS = new Map(Object.entries(RENAME_REFUSAL_MESSAGES).map(([reason, message]) => [message, reason as RenameRefusal]));

/**
 * The same error with a localized message when it is a rename refusal of the
 * server (recognized by its exact English message, see src/shared/protocol.ts);
 * any other error unchanged.
 */
function localizeRefusal(error: unknown): unknown {
  const reason = error instanceof Error ? REASONS.get(error.message) : undefined;
  return reason === undefined ? error : new Error(localized(reason));
}

/** Language client middleware showing the server's rename refusals in the display language. */
export const renameMiddleware: Middleware = {
  async prepareRename(document, position, token, next) {
    try {
      return await next(document, position, token);
    } catch (error) {
      throw localizeRefusal(error);
    }
  },
  async provideRenameEdits(document, position, newName, token, next) {
    try {
      return await next(document, position, newName, token);
    } catch (error) {
      throw localizeRefusal(error);
    }
  },
};
