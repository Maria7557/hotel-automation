import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db/client.js";
import { unsealPrivateValue } from "../src/lib/public-token.js";
import { createPostgresRepositories } from "../src/repositories/postgres.js";

const databaseUrl = process.env.OFFERS_TEST_DATABASE_URL;
const env = { AUTH_SECRET: "offers-integration-secret-at-least-32-characters", PUBLIC_BASE_URL: "https://offers.example", SESSION_TTL_DAYS: 30, corsOrigins: [] };

describe.skipIf(!databaseUrl)("reservation offers PostgreSQL concurrency", () => {
  let core: ReturnType<typeof createDatabase>;
  let app: FastifyInstance;
  const owners: Array<{ id: string; userId: string }> = [];
  beforeAll(async () => {
    core = createDatabase(databaseUrl!);
    await migrate(core.db, { migrationsFolder: "./drizzle" });
    app = await createApp({ env, repositories: createPostgresRepositories(core.db), logger: false });
  }, 20_000);
  afterEach(async () => {
    for (const owner of owners.splice(0)) {
      await core.client`delete from hotels where id = ${owner.id}`;
      await core.client`delete from users where id = ${owner.userId}`;
    }
  });
  afterAll(async () => { await app?.close(); await core?.client.end(); });

  async function setup() {
    const registration = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: `offers-${randomUUID()}@example.com`, password: "a-strong-password", displayName: "Owner" } });
    expect(registration.statusCode, registration.body).toBe(201);
    const headers = { authorization: `Bearer ${registration.json().data.accessToken}` };
    const hotel = await app.inject({ method: "POST", url: "/v1/hotel", headers, payload: { name: "Offers test hotel", city: "Firenze", website: "https://hotel.example/booking" } });
    expect(hotel.statusCode, hotel.body).toBe(201);
    const hotelId = hotel.json().data.hotel.id as string;
    owners.push({ id: hotelId, userId: registration.json().data.user.id });
    const room = await app.inject({ method: "POST", url: "/v1/rooms", headers, payload: { name: "Double room", maxAdults: 2, maxChildren: 0, maxGuests: 2, beds: [], amenities: [], photoUrls: [] } });
    expect(room.statusCode, room.body).toBe(201);
    const created = await app.inject({ method: "POST", url: "/v1/inquiries", headers: { ...headers, "idempotency-key": randomUUID() }, payload: {
      guest: { name: "Phone guest", email: "guest@example.com", phone: "+393331234567" }, checkIn: "2027-01-10", checkOut: "2027-01-12",
      occupancy: { adults: 2, childAges: [] }, mealPlan: "BB", note: "Discussed six prices", sendOffer: false,
    } });
    expect(created.statusCode, created.body).toBe(201);
    const inquiryId = created.json().data.inquiryId as string;
    const reservationNumber = created.json().data.reservationNumber as string;
    const offers = Array.from({ length: 6 }, (_, index) => ({ roomId: room.json().data.room.id, planName: `Offer ${index + 1}`, totalCents: 20_000 + index }));
    const send = (baseOfferId: string | null, key = randomUUID()) => app.inject({ method: "POST", url: `/v1/inquiries/${inquiryId}/offers`, headers: { ...headers, "idempotency-key": key }, payload: { baseOfferId, offers } });
    const tokenFor = async (offerId: string) => {
      const [delivery] = await core.client`select payload from deliveries where offer_version_id = ${offerId} limit 1`;
      return unsealPrivateValue(delivery!.payload.proposalUrlCiphertext, env.AUTH_SECRET).split("/").at(-1)!;
    };
    return { hotelId, roomId: room.json().data.room.id as string, inquiryId, reservationNumber, headers, send, tokenFor };
  }

  function confirm(context: Awaited<ReturnType<typeof setup>>, offerId: string, key: string, overrides: Record<string, string> = {}) {
    return app.inject({ method: "POST", url: `/v1/inquiries/${context.inquiryId}/manual-sent`,
      headers: { ...context.headers, "idempotency-key": key }, payload: { offerId, channel: "email", language: "en", ...overrides } });
  }

  it("binds manual confirmations to the opened offer and replays only identical confirmation details", async () => {
    const context = await setup();
    const initial = await context.send(null);
    const offerId = initial.json().data.inquiry.currentOfferId as string;
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => confirm(context, offerId, key)));
    for (const result of results) expect(result.statusCode, result.body).toBe(200);
    const [counts] = await core.client`select count(*)::int as total from deliveries where inquiry_id = ${context.inquiryId} and payload->>'source' = 'manual'`;
    expect(counts!.total).toBe(1);
    const automatic = await core.client`select channel, state from deliveries where inquiry_id = ${context.inquiryId} and coalesce(payload->>'source', '') <> 'manual'`;
    expect(automatic).toEqual(expect.arrayContaining([{ channel: "email", state: "cancelled" }, { channel: "whatsapp", state: "scheduled" }]));
    for (const overrides of [{ language: "it" }, { channel: "whatsapp" }, { offerId: randomUUID() }]) {
      const conflict = await confirm(context, offerId, key, overrides);
      expect(conflict.statusCode, conflict.body).toBe(409);
      expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    }
    const replacement = await context.send(offerId);
    expect(replacement.statusCode, replacement.body).toBe(201);
    const stale = await confirm(context, offerId, randomUUID());
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().error.code).toBe("OFFERS_CHANGED");
    // A lost-response retry is still successful after a later replacement.
    expect((await confirm(context, offerId, key)).statusCode).toBe(200);
    const newId = replacement.json().data.inquiry.currentOfferId;
    const [current] = await core.client`select count(*)::int as total from deliveries where offer_version_id = ${newId} and payload->>'source' = 'manual'`;
    expect(current!.total).toBe(0);
  });

  it("rejects concurrent cross-inquiry reuse of a hotel-scoped confirmation key", async () => {
    const context = await setup();
    const first = await context.send(null);
    const created = await app.inject({ method: "POST", url: "/v1/inquiries", headers: { ...context.headers, "idempotency-key": randomUUID() }, payload: {
      guest: { name: "Other Guest", email: "other@example.com", phone: "+393331234568" }, checkIn: "2027-01-10", checkOut: "2027-01-12",
      occupancy: { adults: 2, childAges: [] }, mealPlan: "BB", sendOffer: false,
    } });
    expect(created.statusCode, created.body).toBe(201);
    const otherId = created.json().data.inquiryId;
    const second = await app.inject({ method: "POST", url: `/v1/inquiries/${otherId}/offers`, headers: { ...context.headers, "idempotency-key": randomUUID() },
      payload: { baseOfferId: null, offers: [{ roomId: context.roomId, planName: "Other", totalCents: 10000 }] } });
    expect(second.statusCode, second.body).toBe(201);
    const key = randomUUID();
    const results = await Promise.all([confirm(context, first.json().data.inquiry.currentOfferId, key),
      confirm({ ...context, inquiryId: otherId }, second.json().data.inquiry.currentOfferId, key)]);
    expect(results.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);
    expect(results.find(({ statusCode }) => statusCode === 409)!.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("cancels queued sends but preserves processing sends and suppresses their subsequent retries", async () => {
    const context = await setup();
    const sent = await context.send(null);
    const offerId = sent.json().data.inquiry.currentOfferId;
    const repository = createPostgresRepositories(core.db);
    // Isolate this channel, then claim as the real worker does.
    await core.client`update deliveries set state = 'cancelled' where inquiry_id = ${context.inquiryId} and channel = 'whatsapp'`;
    const claim = await repository.deliveryWorker.claimNextOfferDelivery(new Date());
    expect(claim?.delivery.offerVersionId).toBe(offerId);
    expect((await confirm(context, offerId, randomUUID())).statusCode).toBe(200);
    const [processing] = await core.client`select state from deliveries where id = ${claim!.delivery.id}`;
    expect(processing!.state).toBe("processing");
    // External delivery may already have started. A retry after its failure
    // must not be claimed once staff have confirmed sending this version.
    await repository.deliveryWorker.settleClaimedDelivery({ deliveryId: claim!.delivery.id, state: "scheduled", attemptCount: 1,
      nextAttemptAt: new Date(), providerMessageId: null, lastErrorCode: "RETRY", lastErrorMessage: null, processedAt: null, now: new Date() });
    expect(await repository.deliveryWorker.claimNextOfferDelivery(new Date())).toBeNull();
    // Force a creation-time tie to ensure manual confirmation remains visible
    // rather than letting UUID ordering select the old automatic attempt.
    await core.client`update deliveries set created_at = now() where offer_version_id = ${offerId}`;
    const detail = await app.inject({ method: "GET", url: `/v1/inquiries/${context.inquiryId}`, headers: context.headers });
    expect(detail.json().data.inquiry).toMatchObject({ workflowState: "offer_sent", channelStates: { email: "provider_accepted" } });
    const dashboard = await app.inject({ method: "GET", url: "/v1/dashboard?scope=today&status=waiting", headers: context.headers });
    expect(dashboard.json().data.inquiries).toEqual(expect.arrayContaining([expect.objectContaining({ id: context.inquiryId, workflowState: "offer_sent", channelStates: { email: "provider_accepted", whatsapp: "cancelled" } })]));
  });

  it("rejects missing offer IDs, foreign owners and confirmations against expired offers", async () => {
    const context = await setup();
    const sent = await context.send(null);
    const offerId = sent.json().data.inquiry.currentOfferId;
    const missing = await app.inject({ method: "POST", url: `/v1/inquiries/${context.inquiryId}/manual-sent`,
      headers: { ...context.headers, "idempotency-key": randomUUID() }, payload: { channel: "email", language: "en" } });
    expect(missing.statusCode).toBe(400);
    const other = await setup();
    expect((await confirm({ ...context, headers: other.headers }, offerId, randomUUID())).statusCode).toBe(404);
    await core.client`update offer_versions set state = 'expired' where id = ${offerId}`;
    expect((await confirm(context, offerId, randomUUID())).statusCode).toBe(404);
    const [count] = await core.client`select count(*)::int as total from deliveries where inquiry_id = ${context.inquiryId} and payload->>'source' = 'manual'`;
    expect(count!.total).toBe(0);
  });

  it("persists extras and defaults and freezes a calculated alternative stay on the same reservation", async () => {
    const context = await setup();
    const extraId = randomUUID();
    const settings = { extras: [{ id: extraId, name: "Parking", description: "Covered", chargeMode: "per_night", unitPriceCents: 1400, active: true, defaultSelected: true }], defaultDepositPercent: 30, cancellationPolicy: "Flexible cancellation" };
    const saved = await app.inject({ method: "PUT", url: "/v1/offer-settings", headers: context.headers, payload: settings });
    expect(saved.statusCode, saved.body).toBe(200);
    const [stored] = await core.client`select settings from hotel_offer_settings where hotel_id = ${context.hotelId}`;
    expect(stored!.settings).toEqual(settings);
    const rate = await app.inject({ method: "POST", url: `/v1/rooms/${context.roomId}/rates`, headers: context.headers, payload: { planCode: "standard", planName: "Standard", mealPlan: "HB", start: "2027-01-01", endInclusive: "2027-12-31", nightlyBaseCents: 15000 } });
    expect(rate.statusCode, rate.body).toBe(201);
    const sent = await app.inject({ method: "POST", url: `/v1/inquiries/${context.inquiryId}/offers`, headers: { ...context.headers, "idempotency-key": randomUUID() }, payload: { baseOfferId: null, offers: [{ roomId: context.roomId, planCode: "standard", pricingMode: "automatic", mealPlan: "HB", checkIn: "2027-02-01", checkOut: "2027-02-04", quotedTotalCents: 49200 }] } });
    expect(sent.statusCode, sent.body).toBe(201);
    expect(sent.json().data.inquiry.offers[0]).toMatchObject({ totalCents: 49200, depositCents: 14760, extras: [{ quantity: 3, totalCents: 4200 }] });
    const token = await context.tokenFor(sent.json().data.inquiry.currentOfferId);
    expect((await app.inject({ method: "POST", url: `/v1/public/offers/${token}/accept` })).statusCode).toBe(200);
    const [stay] = await core.client`select reservation_number::text, check_in::text, check_out::text, meal_plan, occupancies from inquiries where id = ${context.inquiryId}`;
    expect(stay).toMatchObject({ reservation_number: context.reservationNumber, check_in: "2027-02-01", check_out: "2027-02-04", meal_plan: "HB", occupancies: [{ adults: 2, childrenAges: [] }] });
  });

  it("retries sending concurrently without creating another reservation, offer set, or delivery", async () => {
    const context = await setup();
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 6 }, () => context.send(null, key)));
    expect(results.filter(({ statusCode }) => statusCode === 201)).toHaveLength(1);
    expect(results.filter(({ statusCode }) => statusCode === 200)).toHaveLength(5);
    for (const result of results) expect(result.json().data.inquiry).toMatchObject({ id: context.inquiryId, reservationNumber: context.reservationNumber });
    const [counts] = await core.client`select
      (select count(*)::int from inquiries where hotel_id = ${context.hotelId}) as reservations,
      (select count(*)::int from offer_versions where inquiry_id = ${context.inquiryId}) as offers,
      (select count(*)::int from deliveries where inquiry_id = ${context.inquiryId}) as deliveries`;
    expect(counts).toEqual({ reservations: 1, offers: 1, deliveries: 2 });
  });

  it("allows only one concurrent choice and prevents later editing or switching", async () => {
    const context = await setup();
    const sent = await context.send(null);
    expect(sent.statusCode, sent.body).toBe(201);
    const offerId = sent.json().data.inquiry.currentOfferId;
    const token = await context.tokenFor(offerId);
    const results = await Promise.all([0, 5].map((option) => app.inject({ method: "POST", url: `/v1/public/offers/${token}/accept`, payload: { option } })));
    expect(results.map(({ statusCode }) => statusCode).sort()).toEqual([200, 410]);
    const accepted = results.find(({ statusCode }) => statusCode === 200)!.json().data.offer;
    expect(accepted.offers.map(({ status }: { status: string }) => status).sort()).toEqual(["accepted", ...Array(5).fill("expired")]);
    const edit = await context.send(offerId);
    expect(edit.statusCode, edit.body).toBe(409);
    expect(edit.json().error.code).toBe("RESERVATION_ACCEPTED");
    const [row] = await core.client`select i.reservation_number::text, o.selected_option_index, o.state
      from inquiries i join offer_versions o on o.id = i.current_offer_id where i.id = ${context.inquiryId}`;
    expect(row).toMatchObject({ reservation_number: context.reservationNumber, selected_option_index: accepted.selectedOptionIndex, state: "accepted" });
  });

  it("serializes editing against acceptance of the previous email link", async () => {
    const context = await setup();
    const sent = await context.send(null);
    const offerId = sent.json().data.inquiry.currentOfferId;
    const token = await context.tokenFor(offerId);
    const [edit, accept] = await Promise.all([
      context.send(offerId),
      app.inject({ method: "POST", url: `/v1/public/offers/${token}/accept`, payload: { option: 2 } }),
    ]);
    expect([[201, 410], [409, 200]]).toContainEqual([edit.statusCode, accept.statusCode]);
    const [row] = await core.client`select count(*)::int as reservations from inquiries where hotel_id = ${context.hotelId}`;
    expect(row!.reservations).toBe(1);
    if (edit.statusCode === 201) {
      const previous = await app.inject({ method: "GET", url: `/proposal/${token}` });
      expect(previous.statusCode).toBe(200);
      expect(previous.body).toContain('id="expired-title"');
      expect(previous.body).toContain('href="https://hotel.example/booking"');
    }
  });
});
