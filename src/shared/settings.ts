// Settings shared by the client and the language server. No `vscode` imports.
// Keep keys, defaults and bounds identical to `contributes.configuration` in package.json.

/** Configuration section owned by this extension. */
export const SETTINGS_SECTION = 'ieLua';

export const VALIDATE_MODES = ['manual', 'save', 'type', 'saveAndType'] as const;
export type ValidateMode = (typeof VALIDATE_MODES)[number];

export const DEBOUNCE_MIN_MS = 0;
export const DEBOUNCE_MAX_MS = 10_000;

export interface IeLuaSettings {
  readonly validate: {
    /** When diagnostics are computed. */
    readonly mode: ValidateMode;
    /** Delay in milliseconds after the last edit before validating in `type` modes. */
    readonly debounce: number;
  };
}

export const DEFAULT_SETTINGS: IeLuaSettings = {
  validate: { mode: 'save', debounce: 300 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidateMode(value: unknown): value is ValidateMode {
  return typeof value === 'string' && (VALIDATE_MODES as readonly string[]).includes(value);
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
  return { validate: { mode, debounce } };
}

export function validatesOnType(mode: ValidateMode): boolean {
  return mode === 'type' || mode === 'saveAndType';
}

export function validatesOnSave(mode: ValidateMode): boolean {
  return mode === 'save' || mode === 'saveAndType';
}
