import type * as vscode from 'vscode';
import { LanguageClient, TransportKind, type LanguageClientOptions, type ServerOptions } from 'vscode-languageclient/node';
import { DOCUMENT_SCHEMES, LANGUAGE_IDS } from '../shared/protocol.ts';

export const CLIENT_ID = 'ieLua';
const CLIENT_NAME = 'IE Lua Language Server';

/** Creates and starts the language client. The caller owns disposal. */
export async function startClient(context: vscode.ExtensionContext, outputChannel: vscode.LogOutputChannel): Promise<LanguageClient> {
  const module = context.asAbsolutePath('dist/server/server.js');
  const serverOptions: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    debug: { module, transport: TransportKind.ipc, options: { execArgv: ['--nolazy', '--inspect=6009'] } },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: LANGUAGE_IDS.flatMap((language) => DOCUMENT_SCHEMES.map((scheme) => ({ language, scheme }))),
    outputChannel,
  };
  const client = new LanguageClient(CLIENT_ID, CLIENT_NAME, serverOptions, clientOptions);
  await client.start();
  return client;
}
