import { describe, expect, it } from "vitest";
import { templateLanguages, type MessageTemplateSettings } from "@hotel/contracts";
import { demoOfferSnapshot } from "@hotel/templates";
import { messageSettingsInputSchema, previewSampleSchema } from "../src/http/channel-schemas.js";
import { renderOfferDelivery } from "../src/services/offer-delivery-renderer.js";
import { renderDemoMessagePreview } from "../../mobile/src/api/demo-message-preview";

const legacy = {
  emailSubjectTemplate: "Offerta per {{guest_name}}",
  emailBodyTemplate: "Corpo italiano per {{guest_name}} {{offer_url}}",
  whatsappBodyTemplate: "Messaggio italiano per {{guest_name}} {{offer_url}}",
};
const french = {
  emailSubjectTemplate: "Offre pour {{guest_name}}",
  emailBodyTemplate: "Bonjour {{guest_name}}, votre offre est prête. {{offer_url}}",
  whatsappBodyTemplate: "Bonjour {{guest_name}}, voici votre offre. {{offer_url}}",
};

function render(language: string, channel: "email" | "whatsapp", settings: MessageTemplateSettings) {
  return renderOfferDelivery({
    snapshot: { ...demoOfferSnapshot, guestSnapshot: { ...demoOfferSnapshot.guestSnapshot, language } },
    proposalUrl: "https://offers.example/proposal/token",
    channel,
    settings: { ...settings, hotelId: "hotel", createdAt: new Date(), updatedAt: new Date() },
  });
}

describe("European message templates", () => {
  it.each(templateLanguages)("accepts %s for templates, translations and previews", (language) => {
    const input = { ...legacy, templateLanguage: language, translations: { [language]: french } };
    expect(messageSettingsInputSchema.parse(input)).toEqual(input);
    expect(previewSampleSchema.parse({ language }).language).toBe(language);
  });

  it.each(["fr", "fr-FR", "FR_ca"])("selects French copy for %s without changing Legacy copy", (language) => {
    const settings = { ...legacy, templateLanguage: "it" as const, translations: { fr: french } };
    for (const channel of ["email", "whatsapp"] as const) {
      const result = render(language, channel, settings);
      expect(result.text).toContain("Bonjour Mario Rossi");
      expect(result.text).not.toContain("italiano");
      expect(result.text).toContain("https://offers.example/proposal/token");
      if (result.channel === "email") {
        expect(result.subject).toContain("Offre pour Mario Rossi");
        expect(result.html).toContain('<html lang="fr">');
      }
    }
    expect(settings.emailBodyTemplate).toBe(legacy.emailBodyTemplate);
    expect(settings.templateLanguage).toBe("it");
  });

  it.each(["de-DE", "en-GB", "ja-JP"])("uses Legacy copy when no template exists for %s", (language) => {
    const settings = { ...legacy, translations: { fr: french } };
    expect(render(language, "email", settings).text).toContain("Corpo italiano per Mario Rossi");
    expect(render(language, "whatsapp", settings).text).toContain("Messaggio italiano per Mario Rossi");
  });

  it("uses a configured French Legacy translation instead of an unrelated English translation", () => {
    const settings = { ...legacy, templateLanguage: "fr" as const, translations: {
      fr: french, en: { ...legacy, emailBodyTemplate: "English copy" },
    } };
    const result = render("de-DE", "email", settings);
    expect(result.text).toContain("Bonjour Mario Rossi");
    expect(result.text).not.toContain("English copy");
    expect(result.channel === "email" && result.html).toContain('<html lang="fr">');
  });

  it.each(["email", "whatsapp"] as const)("uses the same translation and fallback in %s demo previews", (channel) => {
    const settings = { ...legacy, translations: { fr: french } };
    const preview = renderDemoMessagePreview(channel, settings, "https://offers.example", "fr");
    expect(preview.text).toContain("Bonjour Mario Rossi");
    expect(preview.offer.url).toBe("https://offers.example/proposal/preview?lang=en");
    const fallback = renderDemoMessagePreview(channel, settings, "https://offers.example", "de");
    expect(fallback.text).toContain("italiano per Mario Rossi");
  });

  it("rejects unsupported language codes and invalid variables in translations", () => {
    expect(messageSettingsInputSchema.safeParse({ ...legacy, templateLanguage: "xx" }).success).toBe(false);
    expect(messageSettingsInputSchema.safeParse({ ...legacy, translations: { xx: french } }).success).toBe(false);
    expect(messageSettingsInputSchema.safeParse({ ...legacy, translations: { fr: { ...french, emailBodyTemplate: "{{password}}" } } }).success).toBe(false);
  });
});
