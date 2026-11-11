import { demoOfferSnapshot, formatMoney } from "@hotel/templates";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { hashPublicToken } from "../src/lib/public-token.js";
import { createTestOfferToken } from "../src/lib/test-offer-token.js";
import { createMemoryRepositories, type MemoryRepositories } from "./helpers/memory-repositories.js";

const env = { AUTH_SECRET: "proposal-language-test-secret-at-least-32-characters", SESSION_TTL_DAYS: 30, corsOrigins: [] };

function languageUrl(html: string, path: string, language: "en" | "it"): string {
  const href = html.match(new RegExp(`<a href="([^"]+)" lang="${language}"`))?.[1];
  expect(href).toBeDefined();
  const url = new URL(href!.replaceAll("&amp;", "&"), `https://offers.example${path}`);
  expect(url.origin).toBe("https://offers.example");
  expect(url.pathname).toBe(path);
  return url.pathname + url.search;
}

describe("proposal language selection routes", () => {
  let app: FastifyInstance;
  let repositories: MemoryRepositories;
  let signedPath: string;
  let hotelId: string;
  const providerFetch = vi.fn<typeof fetch>(async () => { throw new Error("External requests are forbidden in this test"); });

  beforeEach(async () => {
    providerFetch.mockClear();
    repositories = createMemoryRepositories();
    app = await createApp({ env, repositories, providerFetch, logger: false });
    const hotel = await repositories.hotels.createForUser("synthetic-owner", {
      name: "Synthetic Hotel", city: "Rome", countryCode: "IT", locale: "it", currency: "EUR", timezone: "Europe/Rome",
      description: null, email: null, phone: null, website: null, logoUrl: null, photoUrls: [], termsText: null,
    });
    hotelId = hotel.id;
    for (const [index, option] of demoOfferSnapshot.options.entries()) {
      const room = await repositories.inventory.createRoomForUser("synthetic-owner", {
        name: option.roomName, description: null, maxAdults: 2, maxChildren: 0, maxGuests: 2,
        beds: [], amenities: [], photoUrls: [], active: true,
      });
      await repositories.inventory.createRatePeriodForUser("synthetic-owner", room!.id, {
        planCode: "flexible", planName: "Flexible rate", mealPlan: "BB", currency: "EUR",
        start: "2027-06-01", endExclusive: "2027-07-01", nightlyBaseCents: 12_000 + index * 4_000,
        includedAdults: 2, includedChildren: 0, extraAdultCents: 0, extraChildCents: 0,
        boardAdultCents: 0, boardChildCents: 0, maxChildAge: 12, minNights: 1, active: true,
      });
    }
    const token = createTestOfferToken({
      publicKey: hotel.publicKey, checkIn: "2027-06-10", checkOut: "2027-06-12", adults: 2, mealPlan: "BB",
    }, new Date(Date.now() + 60_000), env.AUTH_SECRET);
    signedPath = `/proposal/test/${token}`;
  });

  afterEach(async () => {
    await app.close();
    expect(providerFetch).not.toHaveBeenCalled();
    expect(repositories.automation.deliveries.size).toBe(0);
  });

  function previewPath(kind: "demo" | "signed test"): string {
    return kind === "demo" ? "/proposal/preview" : signedPath;
  }

  function expectNoBookings(): void {
    expect(repositories.automation.inquiries.size).toBe(0);
    expect(repositories.automation.offers.size).toBe(0);
  }

  describe.each(["demo", "signed test"] as const)("%s preview", (kind) => {
    it.each([0, 1])("preserves accepted option %s through repeated Italian/English switches", async (option) => {
      const path = previewPath(kind);
      const accepted = await app.inject({ method: "POST", url: `${path}/accept`,
        headers: { "content-type": "application/x-www-form-urlencoded" }, payload: `option=${option}&lang=it` });
      expect(accepted.statusCode).toBe(303);
      expect(accepted.headers.location).toBe(`${path}?accepted=1&option=${option}&lang=it`);
      let page = await app.inject({ method: "GET", url: accepted.headers.location! });
      for (const language of ["en", "it", "en", "it"] as const) {
        expect(page.statusCode).toBe(200);
        const next = languageUrl(page.body, path, language);
        expect(next).toBe(`${path}?accepted=1&option=${option}&lang=${language}`);
        page = await app.inject({ method: "GET", url: next });
        expect(page.statusCode).toBe(200);
        expect(page.body).toContain(`<html lang="${language}">`);
        expect(page.body).toContain('id="confirmation-title"');
        expect(page.body).toContain(demoOfferSnapshot.options[option]!.roomName);
        expect(page.body).not.toContain(demoOfferSnapshot.options[1 - option]!.roomName);
        expect(page.body).toContain(formatMoney(demoOfferSnapshot.options[option]!.totalCents, language));
        expect(page.body).not.toContain("<form");
        expect(page.headers["cache-control"]).toBe("private, no-store");
        expect(page.body).toContain('class="test-banner"');
      }
      expectNoBookings();
    });

    it("preserves a validated active selection without copying unrelated query parameters", async () => {
      const path = previewPath(kind);
      const page = await app.inject({ method: "GET", url: `${path}?option=1&lang=it&email=guest%40example.com&next=https://evil.example` });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('name="option" value="1" checked');
      const next = languageUrl(page.body, path, "en");
      expect(next).toBe(`${path}?option=1&lang=en`);
      const english = await app.inject({ method: "GET", url: next });
      expect(english.body).toContain('name="option" value="1" checked');
      expect(english.body).toContain('name="lang" value="en"');
      expect(english.body).not.toContain('id="confirmation-title"');
      const accepted = await app.inject({ method: "POST", url: `${path}/accept`, payload: { option: 1, lang: "en" } });
      expect(accepted.headers.location).toBe(`${path}?accepted=1&option=1&lang=en`);
      expectNoBookings();
    });

    it("defaults old links and missing form selection to the first option", async () => {
      const path = previewPath(kind);
      const page = await app.inject({ method: "GET", url: `${path}?accepted=1` });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain("Deluxe Room");
      expect(page.body).not.toContain("Junior Suite");
      expect(languageUrl(page.body, path, "en")).toBe(`${path}?accepted=1&option=0&lang=en`);
      const accepted = await app.inject({ method: "POST", url: `${path}/accept`, payload: {} });
      expect(accepted.headers.location).toBe(`${path}?accepted=1&option=0`);
      expectNoBookings();
    });

    it.each(["-1", "0.5", "2", "NaN", '1&next=https://evil.example', ["0", "1"]].map((option) => ({ option })))(
      "rejects invalid selection $option on both GET and POST", async ({ option }) => {
        const path = previewPath(kind);
        const query = Array.isArray(option) ? "option=0&option=1" : `option=${encodeURIComponent(option)}`;
        expect((await app.inject({ method: "GET", url: `${path}?accepted=1&${query}` })).statusCode).toBe(400);
        const response = await app.inject({ method: "POST", url: `${path}/accept`, payload: { option, lang: "en" } });
        expect(response.statusCode).toBe(400);
        expect(response.headers.location).toBeUndefined();
        expectNoBookings();
      },
    );
  });

  it("still verifies signed test tokens before accepting a selection", async () => {
    const tampered = `${signedPath.slice(0, -1)}${signedPath.endsWith("A") ? "B" : "A"}`;
    expect((await app.inject({ method: "GET", url: `${tampered}?accepted=1&option=1` })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `${tampered}/accept`, payload: { option: 1 } })).statusCode).toBe(404);
    expectNoBookings();
  });

  it("renders an empty signed preview but cannot accept a nonexistent option", async () => {
    repositories.inventory.rates.clear();
    const page = await app.inject({ method: "GET", url: signedPath });
    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain("<form");
    expect(languageUrl(page.body, signedPath, "en")).toBe(`${signedPath}?lang=en`);
    const accepted = await app.inject({ method: "POST", url: `${signedPath}/accept`, payload: {} });
    expect(accepted.statusCode).toBe(400);
    expect(accepted.headers.location).toBeUndefined();
    expectNoBookings();
  });

  it("keeps real acceptance in persisted state through switches, forged queries and a stale form", async () => {
    const token = "synthetic-real-proposal-token-00000001";
    const path = `/proposal/${token}`;
    const now = new Date();
    repositories.automation.inquiries.set("synthetic-inquiry", {
      id: "synthetic-inquiry", hotelId, reservationNumber: "1", idempotencyKey: "synthetic",
      guestName: "Mario Rossi", guestEmail: null, guestPhone: null, locale: "it",
      checkIn: "2027-06-10", checkOut: "2027-06-12", occupancy: { adults: 2, childAges: [] }, mealPlan: "BB",
      source: {}, note: "", attentionReason: null, currentOfferId: "synthetic-offer", closedAt: null, createdAt: now, updatedAt: now,
    });
    repositories.automation.offers.set("synthetic-offer", {
      id: "synthetic-offer", hotelId, inquiryId: "synthetic-inquiry", version: 1, state: "active",
      publicTokenHash: hashPublicToken(token), snapshot: structuredClone(demoOfferSnapshot),
      expiresAt: new Date(now.getTime() + 60_000), acceptedAt: null, selectedOptionIndex: null, revokedAt: null, createdAt: now,
    });
    const forged = await app.inject({ method: "GET", url: `${path}?accepted=1&option=1&lang=it` });
    expect(forged.statusCode).toBe(200);
    expect(forged.body).not.toContain('id="confirmation-title"');
    expect(forged.body).toContain('name="option" value="0" checked');
    const accepted = await app.inject({ method: "POST", url: `${path}/accept`,
      headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "option=1&lang=it" });
    expect(accepted.statusCode).toBe(303);
    expect(accepted.headers.location).toBe(`${path}?lang=it`);
    const savedOffer = structuredClone(repositories.automation.offers.get("synthetic-offer"));
    const savedInquiry = structuredClone(repositories.automation.inquiries.get("synthetic-inquiry"));
    expect(savedOffer).toMatchObject({ state: "accepted", selectedOptionIndex: 1 });
    let page = await app.inject({ method: "GET", url: `${path}?accepted=1&option=0&lang=it` });
    for (const language of ["en", "it", "en", "it"] as const) {
      expect(page.body).toContain("Junior Suite");
      expect(page.body).not.toContain("Deluxe Room");
      const next = languageUrl(page.body, path, language);
      expect(next).toBe(`${path}?lang=${language}`);
      page = await app.inject({ method: "GET", url: next });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain(`<html lang="${language}">`);
      expect(page.body).toContain('id="confirmation-title"');
      expect(page.body).toContain(formatMoney(32_000, language));
      expect(page.body).not.toContain('class="test-banner"');
      expect(repositories.automation.offers.get("synthetic-offer")).toEqual(savedOffer);
      expect(repositories.automation.inquiries.get("synthetic-inquiry")).toEqual(savedInquiry);
    }
    const stale = await app.inject({ method: "POST", url: `${path}/accept`, payload: { option: 0, lang: "en" } });
    expect(stale.statusCode).toBe(303);
    const final = await app.inject({ method: "GET", url: stale.headers.location! });
    expect(final.body).toContain("Junior Suite");
    expect(final.body).not.toContain("Deluxe Room");
    expect(repositories.automation.offers.get("synthetic-offer")).toEqual(savedOffer);
    expect(repositories.automation.inquiries.get("synthetic-inquiry")).toEqual(savedInquiry);
  });
});
