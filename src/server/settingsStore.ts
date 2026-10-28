import type { Connection } from 'vscode-languageserver/node';
import { DEFAULT_SETTINGS, normalizeSettings, SETTINGS_SECTION, type IeLuaSettings } from '../shared/settings.ts';

/**
 * Per-resource settings, from the first source that has a value:
 *
 * 1. `workspace/configuration` for the document URI (VS Code and most LSP
 *    clients), so folder-scoped settings work in multi-root workspaces;
 * 2. the `ieLua` object last pushed with `workspace/didChangeConfiguration`;
 * 3. `initializationOptions.ieLua` from the `initialize` request (how Helix,
 *    Geany and others pass server options);
 * 4. the defaults in src/shared/settings.ts.
 */
export class SettingsStore {
  private readonly connection: Connection;
  private readonly pullSupported: boolean;
  private readonly perResource = new Map<string, Promise<IeLuaSettings>>();
  private pushed: IeLuaSettings;

  constructor(connection: Connection, pullSupported: boolean, initializationOptions: unknown) {
    this.connection = connection;
    this.pullSupported = pullSupported;
    this.pushed = isRecord(initializationOptions) && isRecord(initializationOptions[SETTINGS_SECTION])
      ? normalizeSettings(initializationOptions[SETTINGS_SECTION])
      : DEFAULT_SETTINGS;
  }

  get(uri: string): Promise<IeLuaSettings> {
    if (!this.pullSupported) {
      return Promise.resolve(this.pushed);
    }
    let settings = this.perResource.get(uri);
    if (!settings) {
      settings = this.connection.workspace
        .getConfiguration({ scopeUri: uri, section: SETTINGS_SECTION })
        // A client without settings for this section answers null: fall back to the baseline.
        .then((value: unknown) => (isRecord(value) ? normalizeSettings(value) : this.pushed), (error: unknown) => {
          this.connection.console.error(`Reading "${SETTINGS_SECTION}" settings for ${uri} failed: ${String(error)}`);
          return this.pushed;
        });
      this.perResource.set(uri, settings);
    }
    return settings;
  }

  /** Handles `workspace/didChangeConfiguration`. */
  changed(pushedSettings: unknown): void {
    this.perResource.clear();
    if (isRecord(pushedSettings) && isRecord(pushedSettings[SETTINGS_SECTION])) {
      this.pushed = normalizeSettings(pushedSettings[SETTINGS_SECTION]);
    }
  }

  forget(uri: string): void {
    this.perResource.delete(uri);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
