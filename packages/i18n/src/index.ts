import { createInstance } from "i18next";
import { italian } from "./catalog.js";

export type Language = "en" | "it";
export const supportedLanguages = ["en", "it"] as const;
export function supportedLanguage(value?: string | null): Language | undefined {
  const base = value?.trim().toLowerCase().replaceAll("_", "-").split("-")[0];
  return base === "en" || base === "it" ? base : undefined;
}
export function resolveLanguage(value?: string | null, fallback: Language = "en"): Language {
  return supportedLanguage(value) ?? fallback;
}
export function formatLocale(language?: string | null): string {
  return resolveLanguage(language) === "it" ? "it-IT" : "en-GB";
}
export type TranslationValues = Record<string, string | number>;
export const english: Record<string, string> = Object.fromEntries(Object.keys(italian).map((key) => [key, key]));
for (const noun of ["night", "adult", "child", "person"]) {
  english[`{{count}} ${noun}_one`] = `{{count}} ${noun}`;
  english[`{{count}} ${noun}_other`] = `{{count}} ${{ night: "nights", adult: "adults", child: "children", person: "people" }[noun]}`;
}
english["{{count}} skipped photo_one"] = "{{count}} photo was skipped. Please choose JPEG or PNG files.";
english["{{count}} skipped photo_other"] = "{{count}} photos were skipped. Please choose JPEG or PNG files.";
export function createTranslator(language: Language = "en") {
  const instance = createInstance();
  void instance.init({
    lng: language, fallbackLng: "en", supportedLngs: [...supportedLanguages],
    resources: { en: { translation: english }, it: { translation: italian } },
    keySeparator: false, nsSeparator: false, initImmediate: false, showSupportNotice: false,
    interpolation: { escapeValue: false }, returnNull: false,
  });
  return instance;
}
const serverTranslator = createTranslator();
// Always bind server translation to the render's language; never change shared state.
export function translate(language: Language, text: string, values?: TranslationValues): string {
  return serverTranslator.t(text, { ...values, lng: language, defaultValue: text }) as string;
}
export function money(cents: number, currency: string, language: Language): string {
  return new Intl.NumberFormat(formatLocale(language), { style: "currency", currency }).format(cents / 100);
}
export { italian };

export function validationMessage(language: Language, issue: { code?: string; message: string; minimum?: number | bigint; maximum?: number | bigint; origin?: string }): string {
  if (issue.code === "custom") return translate(language, issue.message);
  if (issue.origin === "string" && issue.minimum !== undefined) return translate(language, "Use at least {{v0}} characters.", { v0: String(issue.minimum) });
  if (issue.origin === "string" && issue.maximum !== undefined) return translate(language, "Use at most {{v0}} characters.", { v0: String(issue.maximum) });
  return translate(language, "Enter a valid value.");
}
