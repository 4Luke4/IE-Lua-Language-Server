// Constants and custom LSP messages shared by client and server. Imports only the
// environment-neutral entry point of vscode-languageserver-protocol, never `vscode`.
import { RequestType } from 'vscode-languageserver-protocol';

/** Language IDs served by the language server. */
export const LANGUAGE_IDS = ['lua', 'ie-menu'] as const;

/** URI schemes served by the language server. */
export const DOCUMENT_SCHEMES = ['file', 'untitled'] as const;

/** Value of `Diagnostic.source` for every diagnostic this server publishes. */
export const DIAGNOSTIC_SOURCE = 'IE Lua';

export interface ValidateDocumentParams {
  readonly uri: string;
}

export interface ValidateDocumentResult {
  /** `false` when the server does not have the document open. */
  readonly validated: boolean;
  /** Number of diagnostics published for the document. */
  readonly diagnosticCount: number;
}

/**
 * `ieLua/validateDocument`: validate one open document now, whatever the
 * `ieLua.validate.mode` setting is, and publish its diagnostics.
 */
export const ValidateDocumentRequest = new RequestType<ValidateDocumentParams, ValidateDocumentResult, void>(
  'ieLua/validateDocument',
);

/** Why the server refuses a `textDocument/prepareRename` or `textDocument/rename` request. */
export type RenameRefusal =
  | 'notAVariable'
  | 'implicitSelf'
  | 'globalNotDefinedHere'
  | 'syntaxErrors'
  | 'invalidName'
  | 'reservedWord'
  | 'conflict';

/**
 * The `ResponseError.message` of each refusal (code `RequestFailed`), shown as
 * is by other editors. LSP declares no error data for these requests, and
 * vscode-languageclient passes only the message of a failed prepareRename on,
 * so the VS Code client recognizes a refusal by its exact text to localize it.
 * Hence no placeholders.
 */
export const RENAME_REFUSAL_MESSAGES: Readonly<Record<RenameRefusal, string>> = {
  notAVariable: 'Only the names of local and global variables can be renamed.',
  implicitSelf: 'The implicit "self" of a method has no declaration and cannot be renamed.',
  globalNotDefinedHere:
    'This global is never assigned in this file. It is defined elsewhere (another file, the game or EEex), so it cannot be renamed here.',
  syntaxErrors: 'Fix the syntax errors first: names in code that does not parse cannot all be found.',
  invalidName: 'The new name is not a valid Lua name: use letters, digits and underscores, and do not start with a digit.',
  reservedWord: 'The new name is a reserved word in Lua.',
  conflict: 'Renaming would change what another name in this file refers to.',
};
