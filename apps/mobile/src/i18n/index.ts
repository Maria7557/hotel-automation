import { createTranslator, formatLocale, resolveLanguage, type Language, type TranslationValues, italian, english } from "@hotel/i18n";

export const i18n = createTranslator();
export const getLanguage = (): Language => resolveLanguage(i18n.resolvedLanguage);
export const locale = (): string => formatLocale(getLanguage());
export const t = (text: string, values?: TranslationValues): string => i18n.t(text, { ...values, defaultValue: text }) as string;
const sourceMessages = new Map<string, string>(Object.entries(italian).map(([source, translated]) => [translated, source]));
// Stored UI notices can survive a language switch; authored values are passed through by their callers.
export const translateLabel = <T>(value: T): T | string => typeof value === "string"
  ? t(Object.hasOwn(english, value) ? value : sourceMessages.get(value) ?? value)
  : value;
