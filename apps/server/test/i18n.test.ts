import { afterEach, describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { createApp } from "../src/app.js";
import { createMemoryRepositories } from "./helpers/memory-repositories.js";
import { renderOfferDelivery } from "../src/services/offer-delivery-renderer.js";
import { demoOfferSnapshot, renderPublicOfferPage } from "@hotel/templates";
import { i18n } from "../../mobile/src/i18n/index";
import { formatOccupancy, formatStay } from "../../mobile/src/requests/presentation";
import { detailHref } from "../../mobile/src/navigation/detail-href";
import { NotificationService } from "../src/services/notifications.js";
import { offerMoney } from "../../mobile/src/requests/offer-format";
import { requestStatusHelp } from "../../mobile/src/requests/status";

const env = { AUTH_SECRET: "test-auth-secret-that-is-at-least-32-characters", SESSION_TTL_DAYS: 30, corsOrigins: [] };
afterEach(async () => { await i18n.changeLanguage("en"); });

describe("full app language behavior", () => {
  it("persists the staff preference in the session and validates supported languages", async () => {
    const repositories = createMemoryRepositories();
    const app = await createApp({ env, repositories, logger: false });
    try {
      const registration = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "languages@example.com", password: "a-secure-test-password", displayName: "Owner" } });
      const headers = { authorization: `Bearer ${registration.json().data.accessToken}` };
      const unauthorized = await app.inject({ method: "PATCH", url: "/v1/auth/preferences", payload: { uiLanguage: "it" } });
      expect(unauthorized.statusCode).toBe(401);
      expect((await app.inject({ method: "PATCH", url: "/v1/auth/preferences", headers, payload: { uiLanguage: "it" } })).statusCode).toBe(200);
      const session = await app.inject({ method: "GET", url: "/v1/auth/session", headers });
      expect(session.json().data.user.uiLanguage).toBe("it");
      expect((await app.inject({ method: "PATCH", url: "/v1/auth/preferences", headers, payload: { uiLanguage: "fr" } })).statusCode).toBe(400);
      const localized = await app.inject({ method: "PATCH", url: "/v1/auth/preferences", headers: { ...headers, "accept-language": "it-IT" }, payload: { uiLanguage: "fr" } });
      expect(localized.json().error.message).toBe("La richiesta contiene dati non validi.");
      const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "languages@example.com", password: "a-secure-test-password" } });
      expect(login.json().data.user.uiLanguage).toBe("it");
    } finally { await app.close(); }
  });
  it("reformats already-loaded request data after switching without changing guest language", async () => {
    const request = { checkIn: "2027-01-10", checkOut: "2027-01-12", occupancy: { adults: 2, childAges: [4] } };
    expect(formatOccupancy(request)).toBe("2 nights · 3 people (2 adults, 1 child)");
    await i18n.changeLanguage("it");
    expect(formatOccupancy(request)).toBe("2 notti · 3 persone (2 adulti, 1 bambino)");
    expect(formatStay(request.checkIn, request.checkOut)).toContain("gen");
    expect(offerMoney(12345)).toContain("123,45");
    expect(detailHref("client", "client-1")).toBe("#/clients/client-1");
    const help = requestStatusHelp({ status: "new", attentionReason: null, email: { status: "pending", state: "scheduled" }, whatsapp: { status: "unused" } });
    expect(help).toContain("Invio automatico in attesa");
    expect(help).toContain("In coda");
    await i18n.changeLanguage("en");
    expect(formatOccupancy(request)).toContain("2 nights");
  });
  it("uses the staff recipient’s language for background notifications", async () => {
    const repositories = createMemoryRepositories();
    const user = await repositories.auth.createUser({ email: "italian@example.com", displayName: "Owner", passwordHash: "hash" });
    const hotel = await repositories.hotels.createForUser(user.id, { name: "Casa", city: "Roma", countryCode: "IT", locale: "en-GB", description: null, currency: "EUR", timezone: "Europe/Rome", email: null, phone: null, website: null, logoUrl: null, photoUrls: [], termsText: null });
    await repositories.auth.updateUserLanguage(user.id, "it");
    await repositories.notifications.registerPushDeviceForUser(user.id, { expoPushToken: "ExponentPushToken[test]", platform: "ios", deviceName: "Phone" });
    const messages: Array<{ title: string; body: string }> = [];
    const notifications = new NotificationService(repositories.notifications, { send: async (batch) => { messages.push(...batch); return []; } }, { configured: false, send: async () => {} });
    await notifications.notify({ type: "payment", hotelId: hotel.id, inquiryId: "inquiry", mealPlan: "BB", guestName: "Anna" });
    expect(messages[0]?.title).toBe("BB · L’ospite ha accettato");
    expect(messages[0]?.body).toContain("Anna è in attesa");
    expect(hotel.locale).toBe("en-GB");
  });
  it("selects custom templates by guest language and falls back to a matching built-in message", () => {
    const snapshot = { ...demoOfferSnapshot, guestSnapshot: { ...demoOfferSnapshot.guestSnapshot, language: "en" } };
    const settings = { hotelId: "hotel", templateLanguage: "it" as const, emailSubjectTemplate: "Oggetto italiano", emailBodyTemplate: "Corpo italiano", whatsappBodyTemplate: "Messaggio italiano", createdAt: new Date(), updatedAt: new Date() };
    const fallback = renderOfferDelivery({ snapshot, proposalUrl: "https://offers.example/proposal/token", channel: "email", settings });
    expect(fallback.channel === "email" && fallback.text).toContain("Hello Mario Rossi");
    expect(fallback.channel === "email" && fallback.html).toContain('<html lang="en">');
    const custom = renderOfferDelivery({ snapshot, proposalUrl: "https://offers.example/proposal/token", channel: "email", settings: { ...settings, translations: { en: { emailSubjectTemplate: "Welcome {{guest_name}}", emailBodyTemplate: "Your stay", whatsappBodyTemplate: "English WhatsApp" } } } });
    expect(custom.channel === "email" && custom.subject).toContain("Welcome Mario Rossi");
    expect(custom.channel === "email" && custom.text).not.toContain("Corpo italiano");
    const html = renderPublicOfferPage(snapshot, { state: "active", acceptActionPath: "/proposal/token/accept", locale: "it" });
    expect(html).toContain('name="lang" value="it"');
    expect(html).toContain('href="?lang=en"');
    expect(snapshot.guestSnapshot.language).toBe("en");
  });
  it("keeps the chosen public language through demo acceptance", async () => {
    const app = await createApp({ env, repositories: createMemoryRepositories(), logger: false });
    try {
      const english = await app.inject({ method: "GET", url: "/proposal/preview?lang=en" });
      expect(english.body).toContain('<html lang="en">');
      expect(english.body).toContain('name="lang" value="en"');
      const accepted = await app.inject({ method: "POST", url: "/proposal/preview/accept", payload: { option: 0, lang: "en" } });
      expect(accepted.headers.location).toContain("lang=en");
      const page = await app.inject({ method: "GET", url: accepted.headers.location! });
      expect(page.body).toContain('<html lang="en">');
      expect(page.body).toContain("Thank you, Mario Rossi.");
    } finally { await app.close(); }
  });
  it.each(["en", "it"] as const)("renders the standalone %s widget with localized accessible board labels", async (language) => {
    const app = await createApp({ env, repositories: createMemoryRepositories(), logger: false });
    try {
      const script = await app.inject({ method: "GET", url: "/embed.js" });
      let html = "";
      const form = { addEventListener() {} };
      const root = { set innerHTML(value: string) { html = value; }, querySelector: (selector: string) => selector === "form" ? form : {} };
      const host = { lang: "", setAttribute() {}, attachShadow: () => root };
      runInNewContext(script.body, { URL, document: { currentScript: { src: "https://api.example/embed.js", dataset: { publicKey: "11111111-1111-4111-8111-111111111111", lang: language }, insertAdjacentElement() {} }, documentElement: { lang: language === "it" ? "en" : "it" }, createElement: () => host } });
      expect(host.lang).toBe(language);
      expect(html).toContain(language === "it" ? "Richiedi disponibilità" : "Request availability");
      expect(html).toContain(language === "it" ? "HB · Mezza pensione" : "HB · Half board");
    } finally { await app.close(); }
  });
});
