import * as vscode from 'vscode';

export const EXTENSION_ID = 'infinity-engine-tools.ie-lua-language-server';

export async function activateExtension(): Promise<void> {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  if (!extension) {
    throw new Error(`Extension ${EXTENSION_ID} is not installed in the test instance.`);
  }
  await extension.activate();
}

export function fixtureUri(...segments: string[]): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error('The integration tests must run with test/fixtures/workspace open.');
  }
  return vscode.Uri.joinPath(folder.uri, ...segments);
}

/**
 * Resolves with the diagnostics of `uri` as soon as `predicate` accepts them.
 * Relies on the Mocha test timeout instead of a fixed sleep.
 */
export function waitForDiagnostics(
  uri: vscode.Uri,
  predicate: (diagnostics: vscode.Diagnostic[]) => boolean,
): Promise<vscode.Diagnostic[]> {
  return new Promise((resolve) => {
    const check = (): boolean => {
      const diagnostics = vscode.languages.getDiagnostics(uri);
      if (predicate(diagnostics)) {
        subscription.dispose();
        resolve(diagnostics);
        return true;
      }
      return false;
    };
    const subscription = vscode.languages.onDidChangeDiagnostics((event) => {
      if (event.uris.some((changed) => changed.toString() === uri.toString())) {
        check();
      }
    });
    check();
  });
}

/** Sets an `ieLua.*` setting for the test workspace and returns a function restoring it. */
export async function withSetting(key: string, value: unknown): Promise<() => Thenable<void>> {
  const config = vscode.workspace.getConfiguration('ieLua');
  const previous = config.inspect(key)?.workspaceValue;
  await config.update(key, value, vscode.ConfigurationTarget.Workspace);
  return () => vscode.workspace.getConfiguration('ieLua').update(key, previous, vscode.ConfigurationTarget.Workspace);
}

export async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

/** `line:character` of each location's start, for compact assertions. */
export function starts(locations: readonly (vscode.Location | vscode.LocationLink)[]): string[] {
  return locations.map((location) => {
    const { start } = 'uri' in location ? location.range : location.targetRange;
    return `${String(start.line)}:${String(start.character)}`;
  });
}

/** Opens a fixture in an editor and returns its URI. */
export async function openFixture(file: string): Promise<vscode.Uri> {
  const uri = fixtureUri(file);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  return uri;
}

/**
 * Resolves with the workspace symbols for `query` as soon as `predicate` accepts
 * them. The server answers only after the file events it has received are indexed,
 * so this asks again until the client has delivered them; the Mocha test timeout
 * bounds the wait instead of a fixed sleep.
 */
export async function waitForWorkspaceSymbols(
  query: string,
  predicate: (symbols: vscode.SymbolInformation[]) => boolean,
): Promise<vscode.SymbolInformation[]> {
  for (;;) {
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', query);
    if (predicate(symbols)) return symbols;
  }
}
