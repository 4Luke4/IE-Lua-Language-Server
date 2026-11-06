// Settings shared by the client and the language server. No `vscode` imports.
// Keep keys, defaults and bounds identical to `contributes.configuration` in package.json.

/** Configuration section owned by this extension. */
export const SETTINGS_SECTION = 'ieLua';

export const VALIDATE_MODES = ['manual', 'save', 'type', 'saveAndType'] as const;
export type ValidateMode = (typeof VALIDATE_MODES)[number];

/**
 * The Lua the game runs: the engine's own Lua 5.2, or the LuaJIT that EEex's
 * experimental "Use LuaJIT" component installs (see scripts/luajit-manual/).
 */
export const RUNTIMES = ['lua52', 'luajit'] as const;
export type Runtime = (typeof RUNTIMES)[number];

export const DEBOUNCE_MIN_MS = 0;
export const DEBOUNCE_MAX_MS = 10_000;

export interface IeLuaSettings {
  readonly validate: {
    /** When diagnostics are computed. */
    readonly mode: ValidateMode;
    /** Delay in milliseconds after the last edit before validating in `type` modes. */
    readonly debounce: number;
  };
  readonly runtime: {
    /** Which compiler checks syntax, and which libraries hover, completion and semantic tokens describe. */
    readonly lua: Runtime;
  };
}

export const DEFAULT_SETTINGS: IeLuaSettings = {
  validate: { mode: 'save', debounce: 300 },
  runtime: { lua: 'lua52' },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidateMode(value: unknown): value is ValidateMode {
  return typeof value === 'string' && (VALIDATE_MODES as readonly string[]).includes(value);
}

function isRuntime(value: unknown): value is Runtime {
  return typeof value === 'string' && (RUNTIMES as readonly string[]).includes(value);
}

/**
 * Turns whatever a client sent for the `ieLua` section into complete, valid settings.
 * Unknown or out-of-range values fall back to the defaults (or are clamped), so a
 * hand-edited settings file or a non-VS Code client can never put the server in an
 * invalid state.
 */
export function normalizeSettings(raw: unknown): IeLuaSettings {
  const validate = isRecord(raw) && isRecord(raw['validate']) ? raw['validate'] : {};
  const mode = isValidateMode(validate['mode']) ? validate['mode'] : DEFAULT_SETTINGS.validate.mode;
  const rawDebounce = validate['debounce'];
  const debounce =
    typeof rawDebounce === 'number' && Number.isFinite(rawDebounce)
      ? Math.min(DEBOUNCE_MAX_MS, Math.max(DEBOUNCE_MIN_MS, Math.round(rawDebounce)))
      : DEFAULT_SETTINGS.validate.debounce;
  const runtime = isRecord(raw) && isRecord(raw['runtime']) ? raw['runtime'] : {};
  const lua = isRuntime(runtime['lua']) ? runtime['lua'] : DEFAULT_SETTINGS.runtime.lua;
  return { validate: { mode, debounce }, runtime: { lua } };
}

export function validatesOnType(mode: ValidateMode): boolean {
  return mode === 'type' || mode === 'saveAndType';
}

export function validatesOnSave(mode: ValidateMode): boolean {
  return mode === 'save' || mode === 'saveAndType';
}
