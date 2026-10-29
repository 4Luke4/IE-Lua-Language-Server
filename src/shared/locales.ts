// The display languages VS Code offers as language packs, besides English:
// https://code.visualstudio.com/docs/configure/locales#_available-locales
// Every localized file (package.nls.<locale>.json, l10n/bundle.l10n.<locale>.json,
// l10n/server/messages.<locale>.json) exists for each; `npm run check-l10n` verifies it.
export const LOCALES = ['cs', 'de', 'es', 'fr', 'hu', 'it', 'ja', 'ko', 'pl', 'pt-br', 'ru', 'tr', 'zh-cn', 'zh-tw'] as const;

export type Locale = (typeof LOCALES)[number];
