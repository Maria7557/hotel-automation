import { DEFAULT_GUEST_LANGUAGE, templateLanguageFor, type TemplateLanguage } from "./languages.js";

export type MessageTemplates = {
  emailSubjectTemplate: string;
  emailBodyTemplate: string;
  whatsappBodyTemplate: string;
};

export type MessageTemplateSettings = MessageTemplates & {
  templateLanguage?: TemplateLanguage | undefined;
  translations?: Partial<Record<TemplateLanguage, MessageTemplates>> | undefined;
};

export function resolveMessageTemplates(settings: MessageTemplateSettings, requestedLanguage?: string | null) {
  const requested = templateLanguageFor(requestedLanguage);
  const translation = requested ? settings.translations?.[requested] : undefined;
  if (requested && translation) return { templates: translation, language: requested };
  const language = settings.templateLanguage ?? DEFAULT_GUEST_LANGUAGE;
  return { templates: settings.translations?.[language] ?? settings, language };
}
