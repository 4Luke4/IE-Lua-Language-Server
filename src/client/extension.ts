import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';
import * as validateDocument from './commands/validateDocument.ts';
import { affectsSettings, readSettings } from './config.ts';
import { startClient } from './lsp.ts';

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel('IE Lua', { log: true });
  context.subscriptions.push(log);

  const logSettings = (): void => {
    const { validate } = readSettings();
    log.info(`Validation mode: ${validate.mode}, debounce: ${validate.debounce} ms`);
  };
  logSettings();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (affectsSettings(event)) {
        logSettings();
      }
    }),
  );

  client = await startClient(context, log);
  context.subscriptions.push(client);
  validateDocument.register(context, { client, log });
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
