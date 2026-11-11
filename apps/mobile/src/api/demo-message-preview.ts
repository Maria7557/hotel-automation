import { DEMO_OFFER_PATH, demoOfferSnapshot, formatMoney } from "@hotel/templates";
import type { MessageChannel, MessagePreview, MessageSettingsInput } from "./types";

export const demoMessageSettings: MessageSettingsInput = {
  templateLanguage: "it",
  emailSubjectTemplate: "La sua offerta da {{hotel_name}}",
  emailBodyTemplate: "Gentile {{guest_name}},\n\nLa sua offerta dal {{check_in}} al {{check_out}} è pronta.\nTotale: {{total}}\n\n{{offer_url}}",
  whatsappBodyTemplate: "Gentile {{guest_name}}, la sua offerta da {{hotel_name}} è pronta: {{offer_url}}",
  translations: {
    it: {
      emailSubjectTemplate: "La sua offerta da {{hotel_name}}",
      emailBodyTemplate: "Gentile {{guest_name}},\n\nLa sua offerta dal {{check_in}} al {{check_out}} è pronta.\nTotale: {{total}}\n\n{{offer_url}}",
      whatsappBodyTemplate: "Gentile {{guest_name}}, la sua offerta da {{hotel_name}} è pronta: {{offer_url}}",
    },
    en: {
      emailSubjectTemplate: "Your offer from {{hotel_name}}",
      emailBodyTemplate: "Dear {{guest_name}},\n\nYour offer from {{check_in}} to {{check_out}} is ready.\nTotal: {{total}}\n\n{{offer_url}}",
      whatsappBodyTemplate: "Dear {{guest_name}}, your offer from {{hotel_name}} is ready: {{offer_url}}",
    },
  },
};

export function renderDemoMessagePreview(channel: MessageChannel, settings: MessageSettingsInput, origin: string): MessagePreview {
  const snapshot = demoOfferSnapshot;
  const guest = { ...snapshot.guestSnapshot, language: settings.templateLanguage ?? "it" };
  const selected = settings.translations?.[guest.language] ?? settings;
  const offer = { url: new URL(`${DEMO_OFFER_PATH}${guest.language === "en" ? "?lang=en" : ""}`, origin).href, hotelName: snapshot.hotelSnapshot.name,
    checkIn: guest.checkIn, checkOut: guest.checkOut, roomNames: snapshot.options.map(({ roomName }) => roomName) };
  const values: Record<string, string> = { guest_name: guest.name, hotel_name: offer.hotelName, check_in: offer.checkIn, check_out: offer.checkOut,
    guest_count: String(guest.occupancy.adults + guest.occupancy.childAges.length), meal_plan: guest.mealPlan,
    total: formatMoney(Math.min(...snapshot.options.map(({ totalCents }) => totalCents)), guest.language), offer_url: offer.url };
  const render = (value: string) => value.replace(/{{\s*([a-z_][a-z0-9_]*)\s*}}/g, (_, key: string) => values[key] ?? "");
  return channel === "email" ? { channel, subject: render(selected.emailSubjectTemplate), text: render(selected.emailBodyTemplate), html: "", offer }
    : { channel, text: render(selected.whatsappBodyTemplate), offer };
}
