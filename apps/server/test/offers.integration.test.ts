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
      guest: { name: "Phone guest", email: "guest@example.com" }, checkIn: "2027-01-10", checkOut: "2027-01-12",
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
    return { hotelId, inquiryId, reservationNumber, headers, send, tokenFor };
  }

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
    expect(counts).toEqual({ reservations: 1, offers: 1, deliveries: 1 });
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
