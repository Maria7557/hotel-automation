import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { unsealPrivateValue } from "../src/lib/public-token.js";
import { createMemoryRepositories, type MemoryRepositories } from "./helpers/memory-repositories.js";

const env = { AUTH_SECRET: "offer-composer-tests-secret-longer-than-32-characters", SESSION_TTL_DAYS: 30, PUBLIC_BASE_URL: "https://offers.example", corsOrigins: [] };
const origin = "https://hotel.example";
const parking = { id: randomUUID(), name: "Covered parking", description: "Reserved space", unitPriceCents: 1400, chargeMode: "per_night", active: true, defaultSelected: true };
const shuttle = { id: randomUUID(), name: "Station transfer", description: "Return journey", unitPriceCents: 2500, chargeMode: "per_stay", active: true, defaultSelected: false };
const settings = { extras: [parking, shuttle], defaultDepositPercent: 30, cancellationPolicy: "Free cancellation until 7 days before arrival." };

describe("automatic offer composer and extras", () => {
  let app: FastifyInstance;
  let repositories: MemoryRepositories;
  beforeEach(async () => { repositories = createMemoryRepositories(); app = await createApp({ env, repositories, logger: false }); });
  afterEach(async () => { await app.close(); });
  async function setup(email = `owner-${randomUUID()}@example.com`) {
    const registered = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email, password: "a-strong-password", displayName: "Owner" } });
    const headers = { authorization: `Bearer ${registered.json().data.accessToken}` };
    const hotel = await app.inject({ method: "POST", url: "/v1/hotel", headers, payload: { name: "Composer Hotel", city: "Florence" } });
    const { id: hotelId, publicKey } = hotel.json().data.hotel;
    await app.inject({ method: "PUT", url: "/v1/hotel/intake-settings", headers, payload: { allowedOrigins: [origin] } });
    const room = await app.inject({ method: "POST", url: "/v1/rooms", headers, payload: { name: "Deluxe", maxAdults: 4, maxChildren: 2, maxGuests: 5, beds: [], amenities: [], photoUrls: [] } });
    const roomId = room.json().data.room.id as string;
    for (const [mealPlan, nightlyBaseCents] of [["BB", 10000], ["HB", 15000]] as const) {
      const rate = await app.inject({ method: "POST", url: `/v1/rooms/${roomId}/rates`, headers, payload: {
        planCode: "flexible", planName: "Flexible rate", mealPlan, start: "2027-01-01", endInclusive: "2027-12-31", nightlyBaseCents,
        includedAdults: 2, includedChildren: 0, extraAdultCents: 3000, extraChildCents: 1000,
      } });
      expect(rate.statusCode, rate.body).toBe(201);
    }
    const save = (value = settings) => app.inject({ method: "PUT", url: "/v1/offer-settings", headers, payload: value });
    expect((await save()).statusCode).toBe(200);
    const intake = (note = "") => app.inject({ method: "POST", url: `/v1/public/hotels/${publicKey}/inquiries`, headers: { origin, "idempotency-key": randomUUID() }, payload: {
      guest: { name: "Anna", email: "anna@example.com", phone: "+393331234567", language: "en-GB" },
      checkIn: "2027-01-10", checkOut: "2027-01-12", occupancy: { adults: 2, childAges: [] }, mealPlan: "BB", note,
    } });
    return { headers, hotelId, roomId, save, intake };
  }

  it("automatically sends ordinary website requests with calculated rates and default extras, but holds guest notes", async () => {
    const owner = await setup();
    const created = await owner.intake();
    expect(created.json().data).toMatchObject({ automated: true, deliveriesScheduled: 2, attentionReason: null });
    const offer = [...repositories.automation.offers.values()][0]!;
    expect((offer.snapshot.options as object[])[0]).toMatchObject({ accommodationCents: 20000, totalCents: 22800, pricingSource: "rates", extras: [{ name: "Covered parking", quantity: 2, totalCents: 2800 }], depositCents: 6840 });
    const before = repositories.automation.offers.size;
    const noted = await owner.intake("Please check if our dog can stay.");
    expect(noted.json().data).toMatchObject({ automated: false, deliveriesScheduled: 0, attentionReason: "manual_review" });
    expect(repositories.automation.offers.size).toBe(before);
    const id = noted.json().data.inquiryId;
    const detail = await app.inject({ method: "GET", url: `/v1/inquiries/${id}`, headers: owner.headers });
    expect(detail.json().data.inquiry).toMatchObject({ note: "Please check if our dog can stay.", offers: [], workflowState: "needs_attention" });
    const editor = await app.inject({ method: "GET", url: `/v1/inquiries/${id}/offer-editor`, headers: owner.headers });
    expect(editor.json().data.suggestions[0]).toMatchObject({ checkIn: "2027-01-10", checkOut: "2027-01-12", occupancy: { adults: 2, childAges: [] }, mealPlan: "BB", totalCents: 22800 });
  });

  it("holds notes in the authenticated website test form and allows whitespace-only notes to automate", async () => {
    const owner = await setup();
    const payload = { guest: { name: "Test", email: "guest@example.com" }, checkIn: "2027-01-10", checkOut: "2027-01-12", occupancy: { adults: 2 }, mealPlan: "BB", note: "Late arrival" };
    const held = await app.inject({ method: "POST", url: "/v1/inquiries/form", headers: { ...owner.headers, "idempotency-key": randomUUID() }, payload });
    expect(held.json().data).toMatchObject({ automated: false, deliveriesScheduled: 0, attentionReason: "manual_review" });
    expect((await owner.intake("   ")).json().data).toMatchObject({ automated: true, deliveriesScheduled: 2 });
  });

  it("previews extras, discounts and deposits and freezes all settings and prices when sent", async () => {
    const owner = await setup();
    const created = (await owner.intake("Please send two alternatives")).json().data;
    const choice = { roomId: owner.roomId, planCode: "flexible", pricingMode: "automatic", note: "As discussed", extraIds: [parking.id, shuttle.id], discountPercent: 10, depositPercent: 30 };
    const preview = await app.inject({ method: "POST", url: `/v1/inquiries/${created.inquiryId}/offers/preview`, headers: owner.headers, payload: choice });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().data.offer).toMatchObject({ accommodationCents: 20000, extras: [{ quantity: 2, totalCents: 2800 }, { quantity: 1, totalCents: 2500 }], discountCents: 2530, totalCents: 22770, depositCents: 6831, cancellationPolicy: settings.cancellationPolicy });
    const sent = await app.inject({ method: "POST", url: `/v1/inquiries/${created.inquiryId}/offers`, headers: { ...owner.headers, "idempotency-key": "send-quoted" }, payload: { baseOfferId: null, offers: [{ ...choice, quotedTotalCents: 22770, totalCents: 1 }] } });
    expect(sent.statusCode, sent.body).toBe(201);
    const detail = sent.json().data.inquiry;
    expect(detail).toMatchObject({ id: created.inquiryId, reservationNumber: created.reservationNumber, offers: [{ totalCents: 22770, status: "available", checkIn: "2027-01-10", mealPlan: "BB" }] });
    const frozen = structuredClone(repositories.automation.offers.get(detail.currentOfferId)!.snapshot);
    await owner.save({ ...settings, extras: [{ ...parking, unitPriceCents: 9900 }, shuttle], cancellationPolicy: "Changed policy" });
    for (const rate of repositories.inventory.rates.values()) rate.nightlyBaseCents = 90000;
    expect(repositories.automation.offers.get(detail.currentOfferId)!.snapshot).toEqual(frozen);
    const delivery = [...repositories.automation.deliveries.values()].find(({ offerVersionId }) => offerVersionId === detail.currentOfferId)!;
    const token = unsealPrivateValue(String(delivery.payload.proposalUrlCiphertext), env.AUTH_SECRET).split("/").at(-1)!;
    const page = await app.inject({ method: "GET", url: `/proposal/${token}` });
    for (const text of ["Covered parking", "Station transfer", "227.70", "68.31", settings.cancellationPolicy]) expect(page.body).toContain(text);
    expect(repositories.automation.inquiries.size).toBe(1);
  });

  it("recalculates alternative dates, guests and board and applies the accepted stay to the same reservation", async () => {
    const owner = await setup();
    const created = (await owner.intake("Alternative dates please")).json().data;
    const sent = await app.inject({ method: "POST", url: `/v1/inquiries/${created.inquiryId}/offers`, headers: { ...owner.headers, "idempotency-key": "alternative" }, payload: { baseOfferId: null, offers: [{
      roomId: owner.roomId, planCode: "flexible", pricingMode: "automatic", checkIn: "2027-01-11", checkOut: "2027-01-14", occupancy: { adults: 3, childAges: [8] }, mealPlan: "HB", extraIds: [parking.id], depositPercent: 50,
    }] } });
    expect(sent.statusCode, sent.body).toBe(201);
    expect(sent.json().data.inquiry.offers[0]).toMatchObject({ accommodationCents: 57000, totalCents: 61200, depositCents: 30600 });
    const delivery = [...repositories.automation.deliveries.values()][0]!;
    const token = unsealPrivateValue(String(delivery.payload.proposalUrlCiphertext), env.AUTH_SECRET).split("/").at(-1)!;
    expect((await app.inject({ method: "POST", url: `/v1/public/offers/${token}/accept`, payload: { option: 0 } })).statusCode).toBe(200);
    const detail = (await app.inject({ method: "GET", url: `/v1/inquiries/${created.inquiryId}`, headers: owner.headers })).json().data.inquiry;
    expect(detail).toMatchObject({ id: created.inquiryId, reservationNumber: created.reservationNumber, checkIn: "2027-01-11", checkOut: "2027-01-14", occupancy: { adults: 3, childAges: [8] }, mealPlan: "HB", offers: [{ status: "accepted" }] });
    const page = await app.inject({ method: "GET", url: `/proposal/${token}` });
    expect(page.body).toContain("14 January 2027");
    expect(page.body).toContain("612.00");
    expect(repositories.automation.inquiries.size).toBe(1);
  });

  it("blocks changed quotes, unavailable extras and missing rates without sending or inventing prices", async () => {
    const owner = await setup();
    const created = (await owner.intake("Review please")).json().data;
    const choice = { roomId: owner.roomId, planCode: "flexible", pricingMode: "automatic", extraIds: [parking.id] };
    await owner.save({ ...settings, extras: [{ ...parking, unitPriceCents: 1500 }, shuttle] });
    const stale = await app.inject({ method: "POST", url: `/v1/inquiries/${created.inquiryId}/offers`, headers: { ...owner.headers, "idempotency-key": "stale" }, payload: { baseOfferId: null, offers: [{ ...choice, quotedTotalCents: 22800 }] } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("OFFER_PRICE_CHANGED");
    for (const patch of [{ extraIds: [randomUUID()] }, { mealPlan: "FB" }, { checkIn: "2028-01-10", checkOut: "2028-01-12" }]) {
      const response = await app.inject({ method: "POST", url: `/v1/inquiries/${created.inquiryId}/offers/preview`, headers: owner.headers, payload: { ...choice, ...patch } });
      expect(response.statusCode, response.body).toBe(422);
    }
    expect(repositories.automation.offers.size).toBe(0);
    expect(repositories.automation.deliveries.size).toBe(0);
  });

  it("isolates the settings and composer by hotel and validates extra IDs and prices", async () => {
    const owner = await setup();
    const other = await setup();
    const created = (await owner.intake("Review please")).json().data;
    expect((await app.inject({ method: "GET", url: "/v1/offer-settings" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/v1/inquiries/${created.inquiryId}/offer-editor`, headers: other.headers })).statusCode).toBe(404);
    await other.save({ ...settings, extras: [] });
    const result = await app.inject({ method: "GET", url: "/v1/offer-settings", headers: owner.headers });
    expect(result.json().data.settings.extras).toHaveLength(2);
    expect((await owner.save({ ...settings, extras: [parking, parking] })).statusCode).toBe(400);
    expect((await owner.save({ ...settings, extras: [{ ...parking, unitPriceCents: -1 }] })).statusCode).toBe(400);
  });
});
