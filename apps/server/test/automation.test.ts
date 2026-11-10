import { createHash } from "node:crypto";
import { OFFER_VALIDITY_MS } from "@hotel/contracts";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { unsealPrivateValue } from "../src/lib/public-token.js";
import { createMemoryRepositories, type MemoryRepositories } from "./helpers/memory-repositories.js";

const origin = "https://hotel.example";
const testEnv = {
  AUTH_SECRET: "test-auth-secret-that-is-at-least-32-characters",
  SESSION_TTL_DAYS: 30,
  PUBLIC_BASE_URL: "https://offers.example",
  corsOrigins: ["http://localhost:8081"],
};

describe("public intake and proposal automation", () => {
  let app: FastifyInstance;
  let repositories: MemoryRepositories;

  beforeEach(async () => {
    repositories = createMemoryRepositories();
    app = await createApp({ env: testEnv, repositories, logger: false });
  });

  afterEach(async () => app.close());

  function sentToken(offerId: string): string {
    const delivery = [...repositories.automation.deliveries.values()].find(({ offerVersionId }) => offerVersionId === offerId)!;
    return unsealPrivateValue(String(delivery.payload.proposalUrlCiphertext), testEnv.AUTH_SECRET).split("/").at(-1)!;
  }

  it("creates an independent reservation with copied offers without requiring a saved client or changing the original", async () => {
    const owner = await setupHotel(app, "duplicate-reservation@example.com", true);
    const created = await intake(app, owner.publicKey, "original-reservation");
    const original = created.json().data;
    const rawToken = original.proposalUrl.split("/").at(-1);
    await app.inject({ method: "POST", url: `/v1/public/offers/${rawToken}/accept` });
    await app.inject({ method: "POST", url: `/v1/inquiries/${original.inquiryId}/payment-link-sent`, headers: auth(owner.token) });
    const originalInquiry = structuredClone(repositories.automation.inquiries.get(original.inquiryId)!);
    const originalOffers = structuredClone([...repositories.automation.offers.values()]);
    const oldDeliveries = structuredClone([...repositories.automation.deliveries.values()]);
    const input = {
      guest: { name: originalInquiry.guestName, email: originalInquiry.guestEmail, phone: originalInquiry.guestPhone, language: originalInquiry.locale },
      checkIn: "2026-07-10", checkOut: "2026-07-12", occupancy: originalInquiry.occupancy,
      mealPlan: originalInquiry.mealPlan, note: originalInquiry.note,
      offers: [{ roomId: owner.roomId, planName: "Copied agreed rate", totalCents: 31_415, note: "Copied offer terms" }],
    };
    const duplicate = await manualIntake(app, owner.token, "duplicate-reservation", input);
    expect(duplicate.statusCode, duplicate.body).toBe(201);
    const result = duplicate.json().data;
    expect(result.inquiryId).not.toBe(original.inquiryId);
    expect(result.reservationNumber).not.toBe(original.reservationNumber);
    expect(result).toMatchObject({ deliveriesScheduled: 0, attentionReason: "manual_review", replayed: false });
    const detail = await app.inject({ method: "GET", url: `/v1/inquiries/${result.inquiryId}`, headers: auth(owner.token) });
    expect(detail.json().data.inquiry).toMatchObject({
      guestName: originalInquiry.guestName, guestEmail: originalInquiry.guestEmail, guestPhone: originalInquiry.guestPhone,
      checkIn: "2026-07-10", checkOut: "2026-07-12", note: originalInquiry.note,
      workflowState: "needs_attention", acceptedAt: null, paymentLinkSentAt: null,
      offers: [expect.objectContaining({ roomId: owner.roomId, planName: "Copied agreed rate", totalCents: 31_415, note: "Copied offer terms", status: "available" })],
    });
    expect(repositories.automation.inquiries.get(original.inquiryId)).toEqual(originalInquiry);
    expect([...repositories.automation.offers.values()].filter(({ inquiryId }) => inquiryId === original.inquiryId)).toEqual(originalOffers);
    expect([...repositories.automation.deliveries.values()]).toEqual(oldDeliveries);
    const replay = await manualIntake(app, owner.token, "duplicate-reservation", input);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data).toMatchObject({ inquiryId: result.inquiryId, reservationNumber: result.reservationNumber, replayed: true });
    expect(repositories.automation.inquiries.size).toBe(2);
    expect(repositories.automation.offers.size).toBe(2);
  });

  it("saves copied offers without contacts and sends the edited prices only when explicitly requested", async () => {
    const owner = await setupHotel(app, "copy-offer-prices@example.com", false);
    const offers = [{ roomId: owner.roomId, planName: "Agreed by phone", totalCents: 27_099, note: "Breakfast included" }];
    const saved = await manualIntake(app, owner.token, "save-copied-offers", { offers });
    expect(saved.statusCode, saved.body).toBe(201);
    expect(saved.json().data.deliveriesScheduled).toBe(0);
    const sent = await manualIntake(app, owner.token, "send-copied-offers", {
      guest: { name: "Guest", email: "guest@example.com" }, offers, sendOffer: true,
    });
    expect(sent.statusCode, sent.body).toBe(201);
    expect(sent.json().data).toMatchObject({ deliveriesScheduled: 1, attentionReason: null });
    const snapshot = [...repositories.automation.offers.values()].find(({ inquiryId }) => inquiryId === sent.json().data.inquiryId)!.snapshot;
    expect(snapshot.options).toEqual([expect.objectContaining({ totalCents: 27_099, note: "Breakfast included", pricingSource: "staff" })]);
    expect([...repositories.automation.deliveries.values()]).toEqual([expect.objectContaining({ recipient: "guest@example.com", state: "scheduled" })]);
  });

  it("rejects copied offers from another hotel or rooms that cannot accommodate the edited guests", async () => {
    const owner = await setupHotel(app, "copy-room-owner@example.com", true);
    const other = await setupHotel(app, "copy-room-other@example.com", true);
    const offer = { roomId: other.roomId, planName: "Other hotel", totalCents: 10_000, note: "" };
    expect((await manualIntake(app, owner.token, "foreign-room", { offers: [offer] })).statusCode).toBe(404);
    const capacity = await manualIntake(app, owner.token, "room-capacity", { occupancy: { adults: 4, childAges: [] }, offers: [{ ...offer, roomId: owner.roomId }] });
    expect(capacity.statusCode).toBe(422);
    expect(capacity.json().error.code).toBe("ROOM_CAPACITY_EXCEEDED");
    for (const offers of [[], Array(7).fill({ ...offer, roomId: owner.roomId }), [{ ...offer, roomId: owner.roomId, totalCents: -1 }]]) {
      expect((await manualIntake(app, owner.token, "invalid-offers", { offers })).statusCode).toBe(400);
    }
    expect(repositories.automation.inquiries.size).toBe(0);
    expect(repositories.automation.offers.size).toBe(0);
    expect(repositories.automation.deliveries.size).toBe(0);
  });

  it("sends and edits six priced offers on the same reservation, with safe retries and stale edit protection", async () => {
    const owner = await setupHotel(app, "six-offers@example.com", true);
    const created = await intake(app, owner.publicKey, "six-offers");
    const { inquiryId, reservationNumber, proposalUrl } = created.json().data;
    const original = repositories.automation.inquiries.get(inquiryId)!;
    const originalOffer = repositories.automation.offers.get(original.currentOfferId!)!;
    expect(Math.abs(originalOffer.expiresAt.getTime() - originalOffer.createdAt.getTime() - OFFER_VALIDITY_MS)).toBeLessThan(1_000);
    const offers = Array.from({ length: 6 }, (_, index) => ({ roomId: owner.roomId, planName: `Agreed option ${index + 1}`, totalCents: 20_000 + index * 1_000, note: "Discussed by phone" }));
    const send = (key: string, baseOfferId: string | null, choices = offers) => app.inject({ method: "POST", url: `/v1/inquiries/${inquiryId}/offers`,
      headers: { ...auth(owner.token), "idempotency-key": key }, payload: { baseOfferId, offers: choices } });
    const sent = await send("six-choices", originalOffer.id);
    expect(sent.statusCode, sent.body).toBe(201);
    const request = sent.json().data.inquiry;
    expect(request).toMatchObject({ id: inquiryId, reservationNumber, note: "Late arrival", attentionReason: null });
    expect(request.offers).toHaveLength(6);
    expect(request.offers.map(({ status }: { status: string }) => status)).toEqual(Array(6).fill("available"));
    expect(repositories.automation.inquiries.size).toBe(1);
    expect(repositories.automation.offers.get(originalOffer.id)?.state).toBe("expired");
    expect([...repositories.automation.deliveries.values()].filter(({ offerVersionId }) => offerVersionId === originalOffer.id).every(({ state }) => state === "cancelled")).toBe(true);
    expect((await app.inject({ method: "GET", url: `/proposal/${proposalUrl.split("/").at(-1)}` })).body).toContain('id="expired-title"');
    const replay = await send("six-choices", originalOffer.id);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.replayed).toBe(true);
    expect(repositories.automation.offers.size).toBe(2);
    expect(repositories.automation.deliveries.size).toBe(4);
    // A retry must still replay its immutable quote after the room leaves the catalog.
    const room = repositories.inventory.rooms.get(owner.roomId)!;
    repositories.inventory.rooms.set(room.id, { ...room, active: false });
    expect((await send("six-choices", originalOffer.id)).statusCode).toBe(200);
    repositories.inventory.rooms.set(room.id, room);
    expect((await send("stale-editor", originalOffer.id)).statusCode).toBe(409);
    const edited = await send("edited-choices", request.currentOfferId, offers.map((offer, i) => i === 0 ? { ...offer, totalCents: 12_345, note: "Updated price" } : offer));
    expect(edited.statusCode, edited.body).toBe(201);
    expect(edited.json().data.inquiry).toMatchObject({ id: inquiryId, reservationNumber });
    expect(edited.json().data.inquiry.offers[0]).toMatchObject({ totalCents: 12_345, note: "Updated price" });
    const token = sentToken(edited.json().data.inquiry.currentOfferId);
    const page = await app.inject({ method: "GET", url: `/proposal/${token}` });
    expect(page.body.match(/class="option-card"/g)).toHaveLength(6);
    expect(page.body).toContain("Updated price");
    expect(page.body).toContain("123.45");
    expect(repositories.automation.inquiries.get(inquiryId)?.reservationNumber).toBe(reservationNumber);
    expect(repositories.automation.inquiries.size).toBe(1);
  });

  it("accepts exactly one of six offers and keeps that choice accepted after the validity period", async () => {
    const owner = await setupHotel(app, "accept-six@example.com", true);
    const created = await intake(app, owner.publicKey, "accept-six");
    const { inquiryId, reservationNumber } = created.json().data;
    const sent = await app.inject({ method: "POST", url: `/v1/inquiries/${inquiryId}/offers`, headers: { ...auth(owner.token), "idempotency-key": "accept-six" }, payload: {
      baseOfferId: repositories.automation.inquiries.get(inquiryId)!.currentOfferId,
      offers: Array.from({ length: 6 }, (_, index) => ({ roomId: owner.roomId, planName: `Offer ${index}`, totalCents: 20_000 + index })),
    } });
    expect(sent.statusCode, sent.body).toBe(201);
    const offerId = sent.json().data.inquiry.currentOfferId;
    const token = sentToken(offerId);
    const results = await Promise.all([1, 4].map((option) => app.inject({ method: "POST", url: `/v1/public/offers/${token}/accept`, payload: { option } })));
    expect(results.map(({ statusCode }) => statusCode).sort()).toEqual([200, 410]);
    const accepted = results.find(({ statusCode }) => statusCode === 200)!.json().data.offer;
    expect(accepted.offers.filter(({ status }: { status: string }) => status === "accepted")).toHaveLength(1);
    expect(accepted.offers.filter(({ status }: { status: string }) => status === "expired")).toHaveLength(5);
    const current = repositories.automation.offers.get(offerId)!;
    repositories.automation.offers.set(offerId, { ...current, expiresAt: new Date(0) });
    expect((await app.inject({ method: "POST", url: `/v1/public/offers/${token}/accept`, payload: { option: accepted.selectedOptionIndex } })).statusCode).toBe(200);
    const page = await app.inject({ method: "GET", url: `/proposal/${token}` });
    expect(page.body).toContain('class="confirmation"');
    expect(page.body).not.toContain('id="expired-title"');
    const blocked = await app.inject({ method: "POST", url: `/v1/inquiries/${inquiryId}/offers`, headers: { ...auth(owner.token), "idempotency-key": "after-acceptance" },
      payload: { baseOfferId: offerId, offers: [{ roomId: owner.roomId, planName: "Too late", totalCents: 100 }] } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("RESERVATION_ACCEPTED");
    const detail = (await app.inject({ method: "GET", url: `/v1/inquiries/${inquiryId}`, headers: auth(owner.token) })).json().data.inquiry;
    expect(detail).toMatchObject({ id: inquiryId, reservationNumber, workflowState: "requires_confirmation", offerSummary: { totalCents: 20_000 + accepted.selectedOptionIndex } });
    expect(detail.offers).toEqual(accepted.offers.map((offer: object) => ({ ...offer, expiresAt: new Date(0).toISOString() })));
    expect(repositories.automation.inquiries.size).toBe(1);
  });

  it("keeps expired email links working and directs stale form submissions to the expired reservation screen", async () => {
    const owner = await setupHotel(app, "expired-screen@example.com", true);
    const created = await intake(app, owner.publicKey, "expired-screen");
    const token = created.json().data.proposalUrl.split("/").at(-1);
    const offer = [...repositories.automation.offers.values()][0]!;
    repositories.automation.offers.set(offer.id, { ...offer, expiresAt: new Date(0) });
    const page = await app.inject({ method: "GET", url: `/proposal/${token}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('id="expired-title"');
    expect(page.body).toContain('href="https://hotel.example/"');
    expect(page.body).toContain("Make a new booking &amp; check availability");
    expect(page.body).not.toContain("<form");
    const staleSubmit = await app.inject({ method: "POST", url: `/proposal/${token}/accept`, payload: { option: 0 } });
    expect(staleSubmit.statusCode).toBe(303);
    expect(staleSubmit.headers.location).toBe(`/proposal/${token}`);
    const detail = (await app.inject({ method: "GET", url: `/v1/inquiries/${created.json().data.inquiryId}`, headers: auth(owner.token) })).json().data.inquiry;
    expect(detail.offers[0].status).toBe("expired");
  });

  it("enforces the six-offer limit, prices, room ownership, authentication, and reservation ownership", async () => {
    const owner = await setupHotel(app, "offer-owner@example.com", true);
    const other = await setupHotel(app, "offer-other@example.com", true);
    const created = await intake(app, owner.publicKey, "offer-validation");
    const id = created.json().data.inquiryId;
    const baseOfferId = repositories.automation.inquiries.get(id)!.currentOfferId;
    const offer = { roomId: owner.roomId, planName: "Agreed offer", totalCents: 20_000 };
    const send = (offers: unknown[], token = owner.token) => app.inject({ method: "POST", url: `/v1/inquiries/${id}/offers`, headers: { ...auth(token), "idempotency-key": "validation" }, payload: { baseOfferId, offers } });
    expect((await app.inject({ method: "POST", url: `/v1/inquiries/${id}/offers`, payload: { baseOfferId, offers: [offer] } })).statusCode).toBe(401);
    expect((await send([offer], other.token)).statusCode).toBe(404);
    expect((await send([{ ...offer, roomId: other.roomId }])).statusCode).toBe(404);
    for (const offers of [[], Array(7).fill(offer), [{ ...offer, totalCents: -1 }], [{ ...offer, totalCents: 123.45 }]]) {
      expect((await send(offers)).statusCode).toBe(400);
    }
    expect(repositories.automation.offers.size).toBe(1);
    expect(repositories.automation.inquiries.size).toBe(1);
  });

  it("adds offers to a manually recorded phone request without creating another reservation", async () => {
    const owner = await setupHotel(app, "phone-offers@example.com", false);
    const created = await app.inject({ method: "POST", url: "/v1/inquiries", headers: { ...auth(owner.token), "idempotency-key": "phone" }, payload: {
      guest: { name: "Phone guest", email: "guest@example.com" }, checkIn: "2027-01-10", checkOut: "2027-01-12",
      occupancy: { adults: 2, childAges: [] }, mealPlan: "HB", receivedVia: "phone", note: "Agreed €250 with dinner", sendOffer: false,
    } });
    expect(created.statusCode).toBe(201);
    const { inquiryId, reservationNumber } = created.json().data;
    const sent = await app.inject({ method: "POST", url: `/v1/inquiries/${inquiryId}/offers`, headers: { ...auth(owner.token), "idempotency-key": "phone-offer" }, payload: {
      baseOfferId: null, offers: [{ roomId: owner.roomId, planName: "As agreed by phone", totalCents: 25_000, note: "Dinner included" }],
    } });
    expect(sent.statusCode, sent.body).toBe(201);
    expect(sent.json().data.inquiry).toMatchObject({ id: inquiryId, reservationNumber, note: "Agreed €250 with dinner", offers: [{ mealPlan: "HB", totalCents: 25_000, status: "available" }] });
    expect(repositories.automation.inquiries.size).toBe(1);
    expect(repositories.automation.offers.size).toBe(1);
  });

  it("saves a phone enquiry without guest contacts or website setup and does not send an offer by default", async () => {
    const owner = await setupHotel(app, "manual-owner@example.com", true);
    await app.inject({ method: "PUT", url: "/v1/hotel/intake-settings", headers: auth(owner.token), payload: { allowedOrigins: [] } });
    const response = await manualIntake(app, owner.token, "called-reception");
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({ automated: false, attentionReason: "manual_review", deliveriesScheduled: 0, replayed: false });
    const result = response.json().data;
    expect(result.reservationNumber).toMatch(/^[1-9]\d*$/);
    const stored = repositories.automation.inquiries.get(result.inquiryId)!;
    expect(stored).toMatchObject({ guestName: "Phone Guest", guestEmail: null, guestPhone: null,
      mealPlan: "BB", note: "Late arrival", source: { type: "manual", receivedVia: "phone" } });
    expect(stored.source.createdByUserId).toEqual(expect.any(String));
    expect(repositories.automation.offers.size).toBe(0);
    expect(repositories.automation.deliveries.size).toBe(0);
    const dashboard = await app.inject({ method: "GET", url: "/v1/dashboard", headers: auth(owner.token) });
    expect(dashboard.json().data.inquiries).toEqual([expect.objectContaining({ id: result.inquiryId, receivedVia: "phone", workflowState: "needs_attention" })]);
  });

  it("saves a walk-in without rooms or rates", async () => {
    const registration = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "walk-in@example.com", password: "a-strong-password" } });
    const token = registration.json().data.accessToken as string;
    await app.inject({ method: "POST", url: "/v1/hotel", headers: auth(token), payload: { name: "Walk-in Hotel", city: "Firenze" } });
    const response = await manualIntake(app, token, "walk-in", { receivedVia: "walk_in" });
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({ automated: false, attentionReason: "manual_review", deliveriesScheduled: 0 });
    expect(repositories.automation.inquiries.get(response.json().data.inquiryId)?.source.receivedVia).toBe("walk_in");
  });

  it("prepares and queues an offer only when staff explicitly selects sending", async () => {
    const owner = await setupHotel(app, "manual-send@example.com", true);
    const response = await manualIntake(app, owner.token, "send-offer", {
      guest: { name: "Calling Guest", email: "caller@example.com", phone: "+393331234567", language: "en-GB" },
      occupancy: { adults: 2, childAges: [7] }, sendOffer: true, receivedVia: "other",
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({ automated: true, deliveriesScheduled: 2, attentionReason: null });
    const result = response.json().data;
    const detail = await app.inject({ method: "GET", url: `/v1/inquiries/${result.inquiryId}`, headers: auth(owner.token) });
    expect(detail.json().data.inquiry).toMatchObject({ reservationNumber: result.reservationNumber, receivedVia: "other", occupancy: { adults: 2, childAges: [7] }, offerSummary: { roomName: "Camera Deluxe", totalCents: 23_000 } });
    expect([...repositories.automation.deliveries.values()]).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "email", state: "scheduled", recipient: "caller@example.com" }),
      expect.objectContaining({ channel: "whatsapp", state: "scheduled", recipient: "+393331234567" }),
    ]));
    const rawToken = result.proposalUrl.split("/").at(-1);
    const acceptance = await app.inject({ method: "POST", url: `/v1/public/offers/${rawToken}/accept` });
    expect(acceptance.statusCode).toBe(200);
    const accepted = await app.inject({ method: "GET", url: `/v1/inquiries/${result.inquiryId}`, headers: auth(owner.token) });
    expect(accepted.json().data.inquiry.workflowState).toBe("requires_confirmation");
  });

  it("keeps manual offers needing review when the requested board has no matching rates", async () => {
    const owner = await setupHotel(app, "manual-board@example.com", true);
    const response = await manualIntake(app, owner.token, "unavailable-board", {
      guest: { name: "Guest", email: "guest@example.com" }, mealPlan: "HB", sendOffer: true,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({ mealPlan: "HB", automated: false, attentionReason: "meal_plan_unavailable", deliveriesScheduled: 0 });
    expect(repositories.automation.offers.size).toBe(0);
    expect(repositories.automation.deliveries.size).toBe(0);
  });

  it("replays concurrent manual submissions without duplicating requests, offers or deliveries", async () => {
    const owner = await setupHotel(app, "manual-retry@example.com", true);
    const input = { guest: { name: "Guest", email: "guest@example.com" }, sendOffer: true };
    const responses = await Promise.all(Array.from({ length: 5 }, () => manualIntake(app, owner.token, "same-call", input)));
    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(4);
    expect(new Set(responses.map((response) => response.json().data.reservationNumber)).size).toBe(1);
    expect(repositories.automation.inquiries.size).toBe(1);
    expect(repositories.automation.offers.size).toBe(1);
    expect(repositories.automation.deliveries.size).toBe(1);
    await intake(app, owner.publicKey, "same-call");
    expect(repositories.automation.inquiries.size).toBe(2);
  });

  it("requires authentication and hotel membership and scopes manual submissions to the staff member’s hotel", async () => {
    const owner = await setupHotel(app, "manual-tenant@example.com", true);
    const other = await setupHotel(app, "manual-other@example.com", true);
    expect((await app.inject({ method: "POST", url: "/v1/inquiries", headers: { "idempotency-key": "unauthorized" }, payload: manualPayload() })).statusCode).toBe(401);
    const registration = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "no-hotel@example.com", password: "a-strong-password" } });
    expect((await manualIntake(app, registration.json().data.accessToken, "no-hotel")).statusCode).toBe(404);
    const created = await manualIntake(app, owner.token, "same-key");
    expect((await app.inject({ method: "GET", url: `/v1/inquiries/${created.json().data.inquiryId}`, headers: auth(other.token) })).statusCode).toBe(404);
    expect((await manualIntake(app, other.token, "same-key")).statusCode).toBe(201);
    expect(repositories.automation.inquiries.size).toBe(2);
  });

  it("validates manual request dates, board, occupancy, contacts and trusted metadata before saving", async () => {
    const owner = await setupHotel(app, "manual-validation@example.com", true);
    const invalidInputs = [
      { guest: { name: " " } }, { guest: { name: "Guest", email: "invalid" } },
      { guest: { name: "Guest", phone: "123" } }, { guest: { name: "Guest", createdByUserId: "forged" } },
      { sendOffer: true }, { sendOffer: true, guest: { name: "Guest", phone: "12345" } },
      { checkIn: "2026-02-30" }, { checkOut: "2026-06-10" },
      { checkOut: "2026-06-09" }, { mealPlan: undefined }, { mealPlan: "bb" }, { mealPlan: "RO" },
      { occupancy: { adults: 0 } }, { occupancy: { adults: 1.5 } },
      { occupancy: { adults: 51 } }, { occupancy: { adults: 2, childAges: [18] } },
      { occupancy: { adults: 2, childAges: Array(21).fill(4) } },
      { receivedVia: "website" }, { sendOffer: "true" }, { hotelId: "11111111-1111-4111-8111-111111111111" },
      { source: { type: "website" } }, { note: "x".repeat(2_001) },
    ];
    for (const [index, input] of invalidInputs.entries()) {
      const response = await manualIntake(app, owner.token, `invalid-${index}`, input);
      expect(response.statusCode, JSON.stringify(input)).toBe(400);
    }
    for (const key of [undefined, " ", "x".repeat(154)]) {
      const response = await app.inject({ method: "POST", url: "/v1/inquiries", headers: { ...auth(owner.token), ...(key === undefined ? {} : { "idempotency-key": key }) }, payload: manualPayload() });
      expect(response.statusCode).toBe(400);
    }
    expect(repositories.automation.inquiries.size).toBe(0);
    expect(repositories.automation.offers.size).toBe(0);
    expect(repositories.automation.deliveries.size).toBe(0);
  });

  it("opens historical reservations with full summaries and isolates them by hotel", async () => {
    const owner = await setupHotel(app, "detail-owner@example.com", true);
    const other = await setupHotel(app, "detail-other@example.com", true);
    const response = await intake(app, owner.publicKey, "historical-detail");
    const id = response.json().data.inquiryId as string;
    const original = repositories.automation.inquiries.get(id)!;
    repositories.automation.inquiries.set(id, { ...original, createdAt: new Date("2020-01-01T12:00:00Z"), note: "Quiet room, please" });
    expect((await app.inject({ method: "GET", url: `/v1/inquiries/${id}` })).statusCode).toBe(401);
    const detail = await app.inject({ method: "GET", url: `/v1/inquiries/${id}`, headers: auth(owner.token) });
    expect(detail.statusCode).toBe(200);
    expect(detail.headers["cache-control"]).toBe("private, no-store");
    expect(detail.json().data.inquiry).toMatchObject({ id, reservationNumber: original.reservationNumber,
      guestName: original.guestName, guestEmail: original.guestEmail, guestPhone: original.guestPhone,
      note: "Quiet room, please", occupancy: original.occupancy, createdAt: "2020-01-01T12:00:00.000Z",
      offerSummary: { roomName: "Camera Deluxe", totalCents: 20_000 }, workflowState: "new",
    });
    const summaries = await app.inject({ method: "POST", url: "/v1/inquiries/summaries", headers: auth(owner.token), payload: { inquiryIds: [id, id] } });
    expect(summaries.json().data.inquiries).toEqual([detail.json().data.inquiry]);
    expect((await app.inject({ method: "GET", url: `/v1/inquiries/${id}`, headers: auth(other.token) })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/v1/inquiries/summaries", headers: auth(other.token), payload: { inquiryIds: [id] } })).json().data.inquiries).toEqual([]);
    expect((await app.inject({ method: "POST", url: "/v1/inquiries/summaries", headers: auth(owner.token), payload: { inquiryIds: Array(101).fill(id) } })).statusCode).toBe(400);
  });

  it("serves an embeddable form script and silently discards honeypot submissions", async () => {
    const script = await app.inject({ method: "GET", url: "/embed.js" });
    expect(script.statusCode).toBe(200);
    expect(script.headers["content-type"]).toContain("application/javascript");
    expect(script.headers["x-content-type-options"]).toBe("nosniff");
    expect(script.body).toContain("data-public-key");
    expect(script.body).toContain("Idempotency-Key");
    expect(script.body).toContain('script.dataset.mode === "adapter"');
    expect(script.body).toContain('formSelector = script.dataset.form || "[data-hotel-inquiry-form]"');
    expect(script.body).toContain('data-hotel-field="');
    expect(script.body).toContain('"existing_form"');
    expect(script.body).toContain('"embed"');
    expect(script.body).toContain("host.attachShadow");
    expect(() => new Function(script.body)).not.toThrow();

    const owner = await setupHotel(app, "honeypot@example.com", true);
    const trapped = await app.inject({
      method: "POST",
      url: `/v1/public/hotels/${owner.publicKey}/inquiries`,
      headers: { origin, "idempotency-key": "bot-submission" },
      payload: {
        guest: { name: "Bot", email: "bot@example.com", phone: null, language: "it" },
        checkIn: "2026-06-10",
        checkOut: "2026-06-12",
        occupancy: { adults: 2, childAges: [] },
        mealPlan: "BB",
        note: "",
        website: "https://spam.example",
        source: { type: "embed" },
      },
    });
    expect(trapped.statusCode).toBe(202);
    expect(repositories.automation.inquiries).toHaveLength(0);
  });

  it("keeps widget mode as the default and exposes selector mapping for an existing form", async () => {
    const script = await app.inject({ method: "GET", url: "/embed.js" });

    expect(script.statusCode).toBe(200);
    expect(script.body).toContain('data-mode="adapter"');
    expect(script.body).toContain("script.dataset.checkIn");
    expect(script.body).toContain("script.dataset.checkOut");
    expect(script.body).toContain("script.dataset.childAges");
    expect(script.body).toContain('[data-hotel-inquiry-status]');
    expect(script.body).toContain('form.dataset.hotelInquiryBound === "true"');
    expect(script.body).toContain('script.dataset.submitBehavior === "replace"');
    expect(script.body).toContain('keepalive: sourceType === "existing_form"');
    expect(script.body).toContain("{ capture: true }");

    const adapterBranch = script.body.indexOf('script.dataset.mode === "adapter"');
    const widgetCreation = script.body.indexOf('document.createElement("div")');
    expect(adapterBranch).toBeGreaterThan(0);
    expect(widgetCreation).toBeGreaterThan(adapterBranch);
  });

  it("captures an existing form submit and maps its fields without replacing the form", async () => {
    const response = await app.inject({ method: "GET", url: "/embed.js" });
    const fields: Record<string, { value: string; type?: string }> = {
      "#arrival": { value: "2026-08-10" },
      "#departure": { value: "2026-08-13" },
      "#guest": { value: "Giulia Bianchi" },
      "#mail": { value: "giulia@example.com" },
      "#phone": { value: "+393331112222" },
      "#adults": { value: "2" },
      "#ages": { value: "4, 9" },
      "#board": { value: "HB" },
      "#message": { value: "Late arrival" },
    };
    const submitButton = { disabled: false };
    const status = { dataset: {} as Record<string, string>, textContent: "" };
    let submitHandler: ((event: { preventDefault(): void; stopImmediatePropagation(): void }) => Promise<void>) | undefined;
    let listenerOptions: unknown;
    const dispatched: string[] = [];
    const form = {
      dataset: {} as Record<string, string>,
      querySelector(selector: string) {
        if (selector === "[data-hotel-inquiry-status]") return status;
        return fields[selector] ?? null;
      },
      querySelectorAll: () => [submitButton],
      addEventListener(_name: string, handler: typeof submitHandler, options: unknown) {
        submitHandler = handler;
        listenerOptions = options;
      },
      dispatchEvent(event: { type: string }) { dispatched.push(event.type); },
    };
    const script = {
      src: "https://api.example.com/embed.js",
      dataset: {
        publicKey: "11111111-1111-4111-8111-111111111111",
        mode: "adapter",
        form: "#booking-form",
        checkIn: "#arrival",
        checkOut: "#departure",
        name: "#guest",
        email: "#mail",
        phone: "#phone",
        adults: "#adults",
        childAges: "#ages",
        mealPlan: "#board",
        note: "#message",
      },
    };
    const documentStub = {
      currentScript: script,
      documentElement: { lang: "it" },
      querySelector: (selector: string) => selector === "#booking-form" ? form : null,
    };
    const requests: Array<{ url: string; init: { body: string; headers: Record<string, string> } }> = [];
    const fetchStub = async (url: string, init: { body: string; headers: Record<string, string> }) => {
      requests.push({ url, init });
      return { ok: true };
    };
    class CustomEventStub {
      constructor(public readonly type: string) {}
    }

    const run = new Function("document", "fetch", "crypto", "location", "CustomEvent", response.body);
    run(documentStub, fetchStub, { randomUUID: () => "request-id" }, { origin: origin, pathname: "/booking" }, CustomEventStub);

    expect(form.dataset.hotelInquiryBound).toBe("true");
    expect(listenerOptions).toEqual({ capture: true });
    expect(submitHandler).toBeTypeOf("function");
    let prevented = false;
    let propagationStopped = false;
    await submitHandler?.({
      preventDefault: () => { prevented = true; },
      stopImmediatePropagation: () => { propagationStopped = true; },
    });

    expect(prevented).toBe(false);
    expect(propagationStopped).toBe(false);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.example.com/v1/public/hotels/11111111-1111-4111-8111-111111111111/inquiries");
    expect(requests[0]?.init.headers["Idempotency-Key"]).toBe("request-id");
    expect(JSON.parse(requests[0]?.init.body ?? "{}")).toMatchObject({
      guest: { name: "Giulia Bianchi", email: "giulia@example.com", phone: "+393331112222", language: "it" },
      checkIn: "2026-08-10",
      checkOut: "2026-08-13",
      occupancy: { adults: 2, childAges: [4, 9] },
      mealPlan: "HB",
      note: "Late arrival",
      source: { type: "existing_form", page: "https://hotel.example/booking", widgetVersion: "v1" },
    });
    expect(submitButton.disabled).toBe(false);
    expect(status).toMatchObject({ dataset: { state: "success" }, textContent: "Request sent. You will receive our offer shortly." });
    expect(dispatched).toEqual(["hotel-inquiry:sending", "hotel-inquiry:success"]);
  });

  it.each(["BB", "HB", "FB"] as const)("prices and preserves a %s request through acceptance", async (mealPlan) => {
    const owner = await setupHotel(app, `${mealPlan}@example.com`, false);
    for (const [board, price] of [["BB", 10_000], ["HB", 16_000], ["FB", 20_000]] as const) {
      const created = await app.inject({
        method: "POST", url: `/v1/rooms/${owner.roomId}/rates`, headers: auth(owner.token),
        payload: { planCode: "standard", planName: "Standard", mealPlan: board,
          start: "2026-01-01", endInclusive: "2026-12-31", nightlyBaseCents: price,
          extraChildCents: 1_500, boardAdultCents: 1_000, boardChildCents: 500 },
      });
      expect(created.statusCode).toBe(201);
    }
    const response = await app.inject({
      method: "POST", url: `/v1/public/hotels/${owner.publicKey}/inquiries`,
      headers: { origin, "idempotency-key": `board-${mealPlan}` },
      payload: { guest: { name: "Board Guest", email: "guest@example.com" }, mealPlan,
        checkIn: "2026-06-10", checkOut: "2026-06-12", occupancy: { adults: 2, childAges: [8] } },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().data).toMatchObject({ mealPlan, automated: true });
    const token = (response.json().data.proposalUrl as string).split("/").at(-1)!;
    const offer = [...repositories.automation.offers.values()][0]!;
    const expected = ({ BB: 28_000, HB: 40_000, FB: 48_000 })[mealPlan];
    expect(offer.snapshot).toMatchObject({ schemaVersion: 2, guestSnapshot: { mealPlan }, options: [{ mealPlan, totalCents: expected }] });
    expect(offer.snapshot.options).toHaveLength(1);
    const page = await app.inject({ method: "GET", url: `/proposal/${token}` });
    expect(page.body).toContain(`${mealPlan} ·`);
    expect(page.body.indexOf(`${mealPlan} ·`)).toBeLessThan(page.body.indexOf('class="room-name"'));

    // Repricing the catalog cannot change the board or price already quoted.
    for (const period of repositories.inventory.rates.values()) period.nightlyBaseCents = 99_999;
    const accepted = await app.inject({ method: "POST", url: `/v1/public/offers/${token}/accept`, payload: { option: 0 } });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().data.offer.snapshot.options).toMatchObject([{ mealPlan, totalCents: expected }]);
    const dashboard = await app.inject({ method: "GET", url: "/v1/dashboard", headers: auth(owner.token) });
    expect(dashboard.json().data.inquiries[0]).toMatchObject({ mealPlan, workflowState: "requires_confirmation", offerSummary: { mealPlan, totalCents: expected } });
    const acceptedPage = await app.inject({ method: "GET", url: `/proposal/${token}` });
    expect(acceptedPage.body).toContain(`${mealPlan} ·`);
  });

  it("keeps an unavailable requested board visible without substituting another board", async () => {
    const owner = await setupHotel(app, "hb-missing@example.com", true);
    const response = await intake(app, owner.publicKey, "missing-hb", origin, "HB");
    expect(response.json().data).toMatchObject({ mealPlan: "HB", automated: false, attentionReason: "meal_plan_unavailable" });
    expect(repositories.automation.offers.size).toBe(0);
    const dashboard = await app.inject({ method: "GET", url: "/v1/dashboard", headers: auth(owner.token) });
    expect(dashboard.json().data.inquiries[0]).toMatchObject({ mealPlan: "HB", offerSummary: null, workflowState: "needs_attention" });
  });

  it.each([undefined, "breakfast", "room_only", "bb", "HB ", "AI", ""])("rejects missing or unsupported website board %s", async (mealPlan) => {
    const owner = await setupHotel(app, "invalid-board@example.com", true);
    const response = await app.inject({ method: "POST", url: `/v1/public/hotels/${owner.publicKey}/inquiries`,
      headers: { origin, "idempotency-key": "invalid-board" }, payload: {
        guest: { name: "Guest", email: "guest@example.com" }, mealPlan,
        checkIn: "2026-06-10", checkOut: "2026-06-12", occupancy: { adults: 2 },
      } });
    expect(response.statusCode).toBe(400);
    expect(repositories.automation.inquiries.size).toBe(0);
  });

  it("rejects acceptance of an option whose board differs from the request", async () => {
    const owner = await setupHotel(app, "mismatch@example.com", true);
    const response = await intake(app, owner.publicKey, "mismatch");
    const token = (response.json().data.proposalUrl as string).split("/").at(-1)!;
    const offer = [...repositories.automation.offers.values()][0]!;
    const options = offer.snapshot.options as Array<Record<string, unknown>>;
    options[0]!.mealPlan = "HB";
    const accepted = await app.inject({ method: "POST", url: `/v1/public/offers/${token}/accept`, payload: { option: 0 } });
    expect(accepted.statusCode).toBe(422);
    expect(offer.acceptedAt).toBeNull();
  });

  it("creates one immutable offer and fake deliveries without persisting the raw token", async () => {
    const owner = await setupHotel(app, "owner@example.com", true);
    const first = await intake(app, owner.publicKey, "same-request");
    expect(first.statusCode).toBe(202);
    expect(first.headers["access-control-allow-origin"]).toBe(origin);
    expect(first.json().data).toMatchObject({ automated: true, deliveriesScheduled: 2, replayed: false });
    const reservationNumber = first.json().data.reservationNumber;
    expect(reservationNumber).toBe("1");
    expect(repositories.automation.inquiries.get(first.json().data.inquiryId)?.reservationNumber).toBe(reservationNumber);

    const proposalUrl = first.json().data.proposalUrl as string;
    const rawToken = proposalUrl.split("/").at(-1) as string;
    expect(rawToken).toBeTruthy();
    expect(repositories.automation.inquiries).toHaveLength(1);
    expect(repositories.automation.offers).toHaveLength(1);
    expect(repositories.automation.deliveries).toHaveLength(2);
    expect(JSON.stringify([...repositories.automation.offers.values()])).not.toContain(rawToken);
    expect(JSON.stringify([...repositories.automation.deliveries.values()])).not.toContain(rawToken);
    expect([...repositories.automation.offers.values()][0]?.publicTokenHash).toBe(
      createHash("sha256").update(rawToken).digest("hex"),
    );

    const initialDashboard = await app.inject({
      method: "GET",
      url: "/v1/dashboard",
      headers: auth(owner.token),
    });
    expect(initialDashboard.statusCode).toBe(200);
    expect(initialDashboard.json().data.inquiries[0]).toMatchObject({
      id: first.json().data.inquiryId,
      reservationNumber,
      guestName: "Mario Rossi",
      checkIn: "2026-06-10",
      checkOut: "2026-06-12",
      occupancy: { adults: 2, childAges: [] },
        mealPlan: "BB",
      offerSummary: { roomName: "Camera Deluxe", totalCents: 20_000, currency: "EUR" },
      channelStates: { email: "scheduled", whatsapp: "scheduled" },
      workflowState: "new",
      attentionReason: null,
    });
    expect(initialDashboard.json().data.inquiries[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    for (const delivery of repositories.automation.deliveries.values()) {
      repositories.automation.deliveries.set(delivery.id, {
        ...delivery,
        state: delivery.channel === "email" ? "delivered" : "failed",
        updatedAt: new Date(),
      });
    }
    const deliveredDashboard = await app.inject({
      method: "GET",
      url: "/v1/dashboard",
      headers: auth(owner.token),
    });
    expect(deliveredDashboard.json().data.inquiries[0]).toMatchObject({
      reservationNumber,
      channelStates: { email: "delivered", whatsapp: "failed" },
      workflowState: "offer_sent",
    });

    const replay = await intake(app, owner.publicKey, "same-request");
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data).toMatchObject({
      inquiryId: first.json().data.inquiryId,
      reservationNumber,
      replayed: true,
      deliveriesScheduled: 2,
    });
    expect(replay.json().data.proposalUrl).toBeUndefined();
    expect(repositories.automation.inquiries).toHaveLength(1);

    const read = await app.inject({ method: "GET", url: `/v1/public/offers/${rawToken}` });
    expect(read.statusCode).toBe(200);
    expect(read.json().data.offer).toMatchObject({ state: "active", acceptedAt: null });

    const page = await app.inject({ method: "GET", url: `/proposal/${rawToken}` });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.headers["cache-control"]).toBe("private, no-store");
    expect(page.headers["x-robots-tag"]).toContain("noindex");
    expect(page.body).toContain(`<form method="post" action="/proposal/${rawToken}/accept"`);
    expect((page.body.match(/<form\b/g) ?? [])).toHaveLength(1);

    const invalidOption = await app.inject({
      method: "POST",
      url: `/v1/public/offers/${rawToken}/accept`,
      payload: { option: 99 },
    });
    expect(invalidOption.statusCode).toBe(422);
    expect(invalidOption.json().error.code).toBe("INVALID_OFFER_OPTION");

    const accepted = await app.inject({
      method: "POST",
      url: `/proposal/${rawToken}/accept`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "option=0",
    });
    expect(accepted.statusCode).toBe(303);
    expect(accepted.headers.location).toBe(`/proposal/${rawToken}`);
    const acceptedOffer = await app.inject({ method: "GET", url: `/v1/public/offers/${rawToken}` });
    const acceptedAt = acceptedOffer.json().data.offer.acceptedAt;
    expect(acceptedOffer.json().data.offer).toMatchObject({
      state: "accepted",
      selectedOptionIndex: 0,
    });
    const repeated = await app.inject({ method: "POST", url: `/v1/public/offers/${rawToken}/accept` });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().data.offer).toMatchObject({ state: "accepted", acceptedAt, selectedOptionIndex: 0 });

    const acceptedDashboard = await app.inject({
      method: "GET",
      url: "/v1/dashboard",
      headers: auth(owner.token),
    });
    expect(acceptedDashboard.json().data).toMatchObject({
      counts: { requiresConfirmation: 1 },
      inquiries: [{ workflowState: "requires_confirmation" }],
    });

    const markedSent = await app.inject({
      method: "POST",
      url: `/v1/inquiries/${first.json().data.inquiryId}/payment-link-sent`,
      headers: auth(owner.token),
    });
    expect(markedSent.statusCode).toBe(200);
    expect(markedSent.json().data).toMatchObject({ inquiryId: first.json().data.inquiryId, reservationNumber });
    expect(markedSent.json().data.paymentLinkSentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const completedDashboard = await app.inject({
      method: "GET",
      url: "/v1/dashboard",
      headers: auth(owner.token),
    });
    expect(completedDashboard.json().data).toMatchObject({
      counts: { requiresConfirmation: 0 },
      inquiries: [{ workflowState: "payment_link_sent", reservationNumber }],
    });

    const acceptedPage = await app.inject({ method: "GET", url: `/proposal/${rawToken}` });
    expect(acceptedPage.statusCode).toBe(200);
    expect(acceptedPage.body).not.toContain("<form");
    expect(acceptedPage.body).toContain('class="confirmation"');
    expect(acceptedPage.body).toContain("You will receive the booking confirmation soon from Hotel owner@example.com.");
    expect(acceptedPage.body).not.toContain("payment link");

    const noGetAccept = await app.inject({ method: "GET", url: `/v1/public/offers/${rawToken}/accept` });
    expect(noGetAccept.statusCode).toBe(404);
  });

  it("enforces the origin allowlist and stores a gap for manual attention without prices", async () => {
    const owner = await setupHotel(app, "owner@example.com", false);
    const denied = await intake(app, owner.publicKey, "denied", "https://evil.example");
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("ORIGIN_NOT_ALLOWED");

    const gap = await intake(app, owner.publicKey, "gap");
    expect(gap.statusCode).toBe(202);
    expect(gap.json().data).toMatchObject({ automated: false, attentionReason: "meal_plan_unavailable" });
    expect(gap.json().data.reservationNumber).toBe("1");
    expect(repositories.automation.offers).toHaveLength(0);
    expect(repositories.automation.deliveries).toHaveLength(0);
    expect(JSON.stringify([...repositories.automation.inquiries.values()])).not.toContain("totalCents");

    const dashboard = await app.inject({ method: "GET", url: "/v1/dashboard", headers: auth(owner.token) });
    expect(dashboard.json().data.inquiries[0]).toMatchObject({
      reservationNumber: gap.json().data.reservationNumber,
      occupancy: { adults: 2, childAges: [] },
        mealPlan: "BB",
      offerSummary: null,
      channelStates: { email: null, whatsapp: null },
      workflowState: "needs_attention",
      attentionReason: "meal_plan_unavailable",
    });
  });

  it("assigns different reservation numbers to simultaneous requests and across hotels", async () => {
    const owner = await setupHotel(app, "owner@example.com", true);
    const other = await setupHotel(app, "other@example.com", false);
    const responses = await Promise.all([
      ...Array.from({ length: 12 }, (_, index) => intake(app, owner.publicKey, `request-${index}`)),
      intake(app, other.publicKey, "request-0"),
    ]);
    const numbers = responses.map((response) => {
      expect(response.statusCode).toBe(202);
      expect(response.json().data.reservationNumber).toMatch(/^[1-9]\d*$/);
      return response.json().data.reservationNumber as string;
    });
    expect(new Set(numbers).size).toBe(responses.length);
    expect(numbers.map(Number).sort((left, right) => left - right)).toEqual(Array.from({ length: 13 }, (_, index) => index + 1));

    const replay = await intake(app, owner.publicKey, "request-0");
    expect(replay.json().data).toMatchObject({ replayed: true, reservationNumber: numbers[0] });
    const dashboard = await app.inject({ method: "GET", url: "/v1/dashboard", headers: auth(owner.token) });
    expect(dashboard.json().data.inquiries.map((inquiry: { reservationNumber: string }) => inquiry.reservationNumber).sort())
      .toEqual(numbers.slice(0, 12).sort());
  });

  it("blocks expired and revoked offers and isolates tenant dashboards", async () => {
    const owner = await setupHotel(app, "owner@example.com", true);
    const other = await setupHotel(app, "other@example.com", true);
    const response = await intake(app, owner.publicKey, "owner-intake");
    const rawToken = (response.json().data.proposalUrl as string).split("/").at(-1) as string;
    const [offer] = repositories.automation.offers.values();
    if (!offer) throw new Error("expected offer");
    repositories.automation.offers.set(offer.id, { ...offer, expiresAt: new Date(0) });
    const expired = await app.inject({ method: "POST", url: `/v1/public/offers/${rawToken}/accept` });
    expect(expired.statusCode).toBe(410);
    expect(expired.json().error.code).toBe("OFFER_EXPIRED");

    repositories.automation.offers.set(offer.id, { ...offer, state: "revoked", revokedAt: new Date() });
    const revoked = await app.inject({ method: "GET", url: `/v1/public/offers/${rawToken}` });
    expect(revoked.statusCode).toBe(410);
    expect(revoked.json().error.code).toBe("OFFER_REVOKED");

    const ownerDashboard = await app.inject({ method: "GET", url: "/v1/dashboard", headers: auth(owner.token) });
    expect(ownerDashboard.json().data.counts.total).toBe(1);
    const otherDashboard = await app.inject({ method: "GET", url: "/v1/dashboard", headers: auth(other.token) });
    expect(otherDashboard.json().data.counts.total).toBe(0);
  });
});

async function setupHotel(app: FastifyInstance, email: string, withRate: boolean) {
  const registration = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: "a-strong-password", displayName: "Owner" },
  });
  const token = registration.json().data.accessToken as string;
  const created = await app.inject({
    method: "POST",
    url: "/v1/hotel",
    headers: auth(token),
    payload: { name: `Hotel ${email}`, city: "Firenze" },
  });
  const hotel = created.json().data.hotel;
  await app.inject({
    method: "PUT",
    url: "/v1/hotel/intake-settings",
    headers: auth(token),
    payload: { allowedOrigins: [origin] },
  });
  const room = await app.inject({
    method: "POST",
    url: "/v1/rooms",
    headers: auth(token),
    payload: {
      name: "Camera Deluxe",
      maxAdults: 2,
      maxChildren: 1,
      maxGuests: 3,
      beds: [{ type: "king", count: 1 }],
      amenities: ["wifi"],
      photoUrls: [],
    },
  });
  if (withRate) {
    await app.inject({
      method: "POST",
      url: `/v1/rooms/${room.json().data.room.id}/rates`,
      headers: auth(token),
      payload: {
        planCode: "BB",
        planName: "Breakfast included",
        mealPlan: "BB",
        start: "2026-01-01",
        endInclusive: "2026-12-31",
        nightlyBaseCents: 10_000,
        includedAdults: 2,
        includedChildren: 0,
        extraAdultCents: 3_000,
        extraChildCents: 1_500,
        maxChildAge: 12,
        minNights: 1,
      },
    });
  }
  return { token, publicKey: hotel.publicKey as string, roomId: room.json().data.room.id as string };
}

function intake(app: FastifyInstance, publicKey: string, key: string, requestOrigin = origin, mealPlan: "BB" | "HB" | "FB" = "BB") {
  return app.inject({
    method: "POST",
    url: `/v1/public/hotels/${publicKey}/inquiries`,
    headers: { origin: requestOrigin, "idempotency-key": key },
    payload: {
      guest: { name: "Mario Rossi", email: "mario@example.com", phone: "+393331234567", language: "it" },
      checkIn: "2026-06-10",
      checkOut: "2026-06-12",
      occupancy: { adults: 2, childAges: [] },
        mealPlan,
      note: "Late arrival",
      source: { widgetVersion: "v1" },
    },
  });
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function manualPayload(overrides: Record<string, unknown> = {}) {
  return { guest: { name: "Phone Guest" }, checkIn: "2026-06-10", checkOut: "2026-06-12",
    occupancy: { adults: 2, childAges: [] }, mealPlan: "BB", note: "Late arrival", ...overrides };
}

function manualIntake(app: FastifyInstance, token: string, key: string, overrides: Record<string, unknown> = {}) {
  return app.inject({ method: "POST", url: "/v1/inquiries", headers: { ...auth(token), "idempotency-key": key }, payload: manualPayload(overrides) });
}
