// Localized messages of the language server, in the language the client asks
// for (`InitializeParams.locale`; VS Code sends its display language). The
// server runs outside VS Code, so it cannot use `vscode.l10n`; the tables in
// l10n/server/ are bundled into the server and checked by `npm run check-l10n`
// (same keys in every locale, code spans and `{n}` placeholders unchanged).
//
// Only the server's own wording is localized. Text quoted from upstream
// documentation (the Lua manual) stays as published.
import cs from '../../l10n/server/messages.cs.json' with { type: 'json' };
import de from '../../l10n/server/messages.de.json' with { type: 'json' };
import es from '../../l10n/server/messages.es.json' with { type: 'json' };
import fr from '../../l10n/server/messages.fr.json' with { type: 'json' };
import hu from '../../l10n/server/messages.hu.json' with { type: 'json' };
import it from '../../l10n/server/messages.it.json' with { type: 'json' };
import ja from '../../l10n/server/messages.ja.json' with { type: 'json' };
import en from '../../l10n/server/messages.json' with { type: 'json' };
import ko from '../../l10n/server/messages.ko.json' with { type: 'json' };
import pl from '../../l10n/server/messages.pl.json' with { type: 'json' };
import ptBr from '../../l10n/server/messages.pt-br.json' with { type: 'json' };
import ru from '../../l10n/server/messages.ru.json' with { type: 'json' };
import tr from '../../l10n/server/messages.tr.json' with { type: 'json' };
import zhCn from '../../l10n/server/messages.zh-cn.json' with { type: 'json' };
import zhTw from '../../l10n/server/messages.zh-tw.json' with { type: 'json' };
import { LOCALES, type Locale } from '../shared/locales.ts';

/** Keys of the English table, the source of every translation. */
export type MessageKey = keyof typeof en;

export type MessageTable = Readonly<Record<string, string>>;

const TRANSLATIONS: Readonly<Record<Locale, MessageTable>> = {
  cs, de, es, fr, hu, it, ja, ko, pl, 'pt-br': ptBr, ru, tr, 'zh-cn': zhCn, 'zh-tw': zhTw,
};

/**
 * The supported locale for a requested one (BCP 47, any letter case): an
 * exact match, else the requested language without its region or script
 * (`de-AT` → `de`). Regional variants are never substituted for each other
 * (`pt-PT` does not get `pt-br`, `zh-Hans` does not get `zh-cn`): `undefined`
 * means English.
 */
export function resolveLocale(requested: string | undefined): Locale | undefined {
  const wanted = requested?.trim().toLowerCase().replaceAll('_', '-');
  if (!wanted) return undefined;
  const language = wanted.split('-')[0];
  return LOCALES.find((locale) => locale === wanted) ?? LOCALES.find((locale) => locale === language);
}

/** Replaces `{0}`, `{1}`, … with the arguments; other text is kept. */
export function format(template: string, args: readonly string[]): string {
  return template.replace(/\{(\d+)\}/g, (placeholder, index: string) => args[Number(index)] ?? placeholder);
}

export interface Messages {
  /** The supported locale in use; `undefined` for English. */
  readonly locale: Locale | undefined;
  /** The message for `key` in the locale, falling back to English, with `{n}` replaced by `args[n]`. */
  t(key: MessageKey, ...args: string[]): string;
}

/** Messages from explicit tables (for tests); see `createMessages`. */
export function messagesFrom(english: MessageTable, translation: MessageTable | undefined, locale: Locale | undefined): Messages {
  return {
    locale,
    t: (key, ...args) => format(translation?.[key] ?? english[key] ?? key, args),
  };
}

/** The server's messages for the client's requested locale. */
export function createMessages(requested: string | undefined): Messages {
  const locale = resolveLocale(requested);
  return messagesFrom(en, locale && TRANSLATIONS[locale], locale);
}
