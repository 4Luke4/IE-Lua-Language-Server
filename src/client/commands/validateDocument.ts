import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';
import { LANGUAGE_IDS, ValidateDocumentRequest, type ValidateDocumentResult } from '../../shared/protocol.ts';

export const COMMAND_ID = 'ieLua.validateDocument';

export interface ValidateDocumentDeps {
  readonly client: LanguageClient;
  readonly log: vscode.LogOutputChannel;
}

/**
 * `ieLua.validateDocument [uri]`: validates the given document (default: the
 * active editor's) regardless of `ieLua.validate.mode`.
 */
export function register(context: vscode.ExtensionContext, deps: ValidateDocumentDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_ID, async (uri?: unknown): Promise<ValidateDocumentResult | undefined> => {
      const document = uri instanceof vscode.Uri
        ? vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === uri.toString())
        : vscode.window.activeTextEditor?.document;
      if (!document || !(LANGUAGE_IDS as readonly string[]).includes(document.languageId)) {
        void vscode.window.showWarningMessage(vscode.l10n.t('Open a Lua or Infinity Engine menu file to validate it.'));
        return undefined;
      }
      try {
        const result = await deps.client.sendRequest(ValidateDocumentRequest, {
          uri: deps.client.code2ProtocolConverter.asUri(document.uri),
        });
        vscode.window.setStatusBarMessage(
          result.diagnosticCount === 0
            ? vscode.l10n.t('IE Lua: no problems found.')
            : vscode.l10n.t('IE Lua: {0} problem(s) found.', result.diagnosticCount),
          5000,
        );
        return result;
      } catch (error) {
        deps.log.error(`${COMMAND_ID} failed for ${document.uri.toString()}:`, error);
        void vscode.window.showErrorMessage(vscode.l10n.t('IE Lua: validation failed. See the "IE Lua" output for details.'));
        return undefined;
      }
    }),
  );
}
