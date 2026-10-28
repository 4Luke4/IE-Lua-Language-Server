// The only place the client reads `ieLua.*` settings (CLAUDE.md §4.5).
// Defaults and normalization are shared with the server via src/shared/settings.ts,
// which mirrors `contributes.configuration` in package.json.
import * as vscode from 'vscode';
import { normalizeSettings, SETTINGS_SECTION, type IeLuaSettings } from '../shared/settings.ts';

export function readSettings(scope?: vscode.ConfigurationScope): IeLuaSettings {
  const config = vscode.workspace.getConfiguration(SETTINGS_SECTION, scope);
  return normalizeSettings({
    validate: {
      mode: config.get<unknown>('validate.mode'),
      debounce: config.get<unknown>('validate.debounce'),
    },
  });
}

export function affectsSettings(event: vscode.ConfigurationChangeEvent): boolean {
  return event.affectsConfiguration(SETTINGS_SECTION);
}
