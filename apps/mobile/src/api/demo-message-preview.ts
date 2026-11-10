import { DEMO_OFFER_PATH, demoOfferSnapshot, formatMoney } from "@hotel/templates";
import type { MessageChannel, MessagePreview, MessageSettingsInput } from "./types";

export function renderDemoMessagePreview(channel: MessageChannel, settings: MessageSettingsInput, origin: string): MessagePreview {
  const snapshot = demoOfferSnapshot;
  const guest = { ...snapshot.guestSnapshot, language: settings.templateLanguage ?? "it" };
  const offer = { url: new URL(`${DEMO_OFFER_PATH}${guest.language === "en" ? "?lang=en" : ""}`, origin).href, hotelName: snapshot.hotelSnapshot.name,
    checkIn: guest.checkIn, checkOut: guest.checkOut, roomNames: snapshot.options.map(({ roomName }) => roomName) };
  const values: Record<string, string> = { guest_name: guest.name, hotel_name: offer.hotelName, check_in: offer.checkIn, check_out: offer.checkOut,
    guest_count: String(guest.occupancy.adults + guest.occupancy.childAges.length), meal_plan: guest.mealPlan,
    total: formatMoney(Math.min(...snapshot.options.map(({ totalCents }) => totalCents)), guest.language), offer_url: offer.url };
  const render = (value: string) => value.replace(/{{\s*([a-z_][a-z0-9_]*)\s*}}/g, (_, key: string) => values[key] ?? "");
  return channel === "email" ? { channel, subject: render(settings.emailSubjectTemplate), text: render(settings.emailBodyTemplate), html: "", offer }
    : { channel, text: render(settings.whatsappBodyTemplate), offer };
}
