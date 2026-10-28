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
