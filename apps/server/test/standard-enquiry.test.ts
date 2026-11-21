import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { inquiryFormInputSchema, manualInquiryInputSchema } from "@hotel/contracts";
import { createApp } from "../src/app.js";
import { createMemoryRepositories } from "./helpers/memory-repositories.js";
import { formatOccupancyParts } from "../../mobile/src/requests/presentation.js";

const standard = () => ({
  guest: { name: "Maria Rossi", email: "maria@example.test", phone: "+393331234567", language: "it" },
  checkIn: "2027-05-10", checkOut: "2027-05-15", mealPlan: "BB", occupancy: { adults: 2, childAges: [0, 7] }, note: "",
  details: { firstName: "Maria", lastName: "Rossi", alternativeDates: [] as Array<{ checkIn: string; checkOut: string }>, additionalRooms: [] as Array<{ mealPlan: string; occupancy: { adults: number; childAges: number[] } }>, consents: { privacy: true, marketing: false } },
});

describe("standard enquiry fields", () => {
  let app: FastifyInstance;
  let repositories: ReturnType<typeof createMemoryRepositories>;
  let headers: { authorization: string };
  let publicKey: string;
  beforeEach(async () => {
    repositories = createMemoryRepositories();
    app = await createApp({ env: { AUTH_SECRET: "standard-enquiry-test-secret-1234567890", SESSION_TTL_DAYS: 30, corsOrigins: [] }, repositories });
    const registered = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "standard@example.test", password: "a-strong-test-password" } });
    headers = { authorization: `Bearer ${registered.json().data.accessToken}` };
    const hotel = await app.inject({ method: "POST", url: "/v1/hotel", headers, payload: { name: "Standard hotel", city: "Roma" } });
    publicKey = hotel.json().data.hotel.publicKey;
    await app.inject({ method: "PUT", url: "/v1/hotel/intake-settings", headers, payload: { allowedOrigins: ["https://hotel.example"] } });
  });
  afterEach(async () => { await app.close(); });

  it("requires separate names, contacts and privacy consent on the standard guest form", () => {
    expect(inquiryFormInputSchema.safeParse(standard()).success).toBe(true);
    for (const missing of ["firstName", "lastName"] as const) {
      const input = standard(); input.details[missing] = "";
      expect(inquiryFormInputSchema.safeParse(input).success).toBe(false);
    }
    const noConsent = standard(); noConsent.details.consents.privacy = false;
    expect(inquiryFormInputSchema.safeParse(noConsent).success).toBe(false);
    expect(inquiryFormInputSchema.safeParse({ ...standard(), guest: { ...standard().guest, email: null } }).success).toBe(false);
    expect(inquiryFormInputSchema.safeParse({ ...standard(), guest: { ...standard().guest, phone: null } }).success).toBe(false);
    expect(manualInquiryInputSchema.safeParse({ ...noConsent, sendOffer: false }).success).toBe(true);
  });

  it("validates every additional room, child age and alternative date range", () => {
    const input = standard();
    input.details.additionalRooms = [{ mealPlan: "HB", occupancy: { adults: 2, childAges: [0, 17] } }];
    input.details.alternativeDates = [{ checkIn: "2027-05-20", checkOut: "2027-05-25" }];
    expect(inquiryFormInputSchema.safeParse(input).success).toBe(true);
    input.details.additionalRooms[0]!.occupancy.childAges = [18];
    expect(inquiryFormInputSchema.safeParse(input).success).toBe(false);
    input.details.additionalRooms[0]!.occupancy.childAges = [7];
    input.details.alternativeDates[0]!.checkOut = "2027-05-19";
    expect(inquiryFormInputSchema.safeParse(input).success).toBe(false);
  });

  it("counts guests across requested rooms and uses the accepted stay after acceptance", () => {
    const input = standard();
    input.details.additionalRooms = [{ mealPlan: "HB", occupancy: { adults: 3, childAges: [4, 9] } }];
    const parsed = inquiryFormInputSchema.parse(input);
    const stay = { checkIn: parsed.checkIn, checkOut: parsed.checkOut, occupancy: parsed.occupancy, details: parsed.details ?? null };
    expect(formatOccupancyParts(stay).people).toBe(9);
    expect(formatOccupancyParts({ ...stay, acceptedAt: new Date().toISOString() }).people).toBe(4);
  });

  it.each(["website", "form", "manual"] as const)("persists all %s room and date details, withholds automatic offers, and returns them to staff", async (channel) => {
    const input = standard();
    input.details.additionalRooms = [{ mealPlan: "HB", occupancy: { adults: 3, childAges: [4, 9] } }];
    input.details.alternativeDates = [{ checkIn: "2027-06-10", checkOut: "2027-06-15" }];
    const url = channel === "website" ? `/v1/public/hotels/${publicKey}/inquiries` : channel === "form" ? "/v1/inquiries/form" : "/v1/inquiries";
    const response = await app.inject({ method: "POST", url, headers: { ...(channel === "website" ? { origin: "https://hotel.example" } : headers), "idempotency-key": randomUUID() }, payload: { ...input, ...(channel === "manual" ? { sendOffer: true } : {}) } });
    expect(response.statusCode, response.body).toBe(channel === "manual" ? 201 : 202);
    expect(response.json().data).toMatchObject({ automated: false, attentionReason: "manual_review", deliveriesScheduled: 0 });
    expect(repositories.automation.offers.size).toBe(0);
    expect(repositories.automation.deliveries.size).toBe(0);
    const inquiryId = response.json().data.inquiryId;
    expect(repositories.automation.inquiries.get(inquiryId)?.source.enquiryDetails).toEqual(input.details);
    const detail = await app.inject({ method: "GET", url: `/v1/inquiries/${inquiryId}`, headers });
    expect(detail.json().data.inquiry.details).toEqual(input.details);
    expect(repositories.automation.inquiries.get(inquiryId)?.source.consentRecordedAt).toBeTypeOf("string");
  });

  it("renders fields in the reference order using date pickers, selects and autofill hints", async () => {
    const response = await app.inject({ method: "GET", url: "/embed.js" });
    const form = { addEventListener() {}, querySelector: () => ({ addEventListener() {} }) };
    const root = { innerHTML: "", appendChild() {}, querySelector: (selector: string) => selector === "form" ? form : {} };
    const host = { setAttribute() {}, attachShadow: () => root };
    runInNewContext(response.body, { URL, document: { currentScript: { src: "https://api.example/embed.js", dataset: { publicKey, lang: "en" }, insertAdjacentElement() {} }, documentElement: { lang: "en" }, createElement: () => host } });
    const html = root.innerHTML;
    expect([...html.matchAll(/\bname="([^"]+)"/g)].map((match) => match[1])).toEqual(["firstName", "lastName", "email", "phone", "checkIn", "checkOut", "mealPlan", "adults", "children", "note", "language", "marketingConsent", "privacyConsent", "website"]);
    expect(html).not.toContain('type="number"');
    expect(html).toContain('autocomplete="given-name"');
    expect(html).toContain('autocomplete="family-name"');
    expect(html).toContain('type="tel" inputmode="tel" autocomplete="tel"');
    expect(html).toContain('type="date"');
    expect(html).toContain('<select aria-label="Adults" required name="adults">');
    expect(html).toContain('<select aria-label="Treatment" required name="mealPlan">');
    expect(html).not.toContain('type="radio" name="mealPlan"');
  });
});
