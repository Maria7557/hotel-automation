export const DEFAULT_GUEST_LANGUAGE = "it";

export const templateLanguages = [
  "en", "it", "fr", "de", "es", "pt", "nl", "pl", "uk", "ru", "ro", "cs", "el", "hu",
  "sv", "da", "no", "fi", "bg", "hr", "sr", "sk", "sl", "et", "lv", "lt", "be", "tr",
] as const;

export type TemplateLanguage = typeof templateLanguages[number];

export function templateLanguageFor(value?: string | null): TemplateLanguage | undefined {
  const base = value?.trim().toLowerCase().replaceAll("_", "-").split("-")[0];
  return templateLanguages.find((language) => language === base);
}
