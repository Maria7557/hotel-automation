import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db/client.js";
import { createPostgresRepositories } from "../src/repositories/postgres.js";
import { createClientConnection, PostgresClientRepository } from "../src/repositories/clients.js";
import { ClientWorker } from "../src/services/client-worker.js";

const databaseUrl = process.env.CONTACTS_TEST_DATABASE_URL;
const env = { AUTH_SECRET: "contacts-test-secret-that-is-at-least-32-characters", SESSION_TTL_DAYS: 30, corsOrigins: ["https://hotel.example"] };
const origin = "https://hotel.example";
const logger = { info: () => {}, error: () => {} };

describe.skipIf(!databaseUrl)("contacts PostgreSQL and HTTP integration", () => {
  let core: ReturnType<typeof createDatabase>;
  let contacts: ReturnType<typeof createClientConnection>;
  let workerConnection: ReturnType<typeof createClientConnection>;
  let repository: PostgresClientRepository;
  let worker: ClientWorker;
  let app: FastifyInstance;
  const owners: Array<{ token: string; id: string; userId: string; publicKey: string }> = [];
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  beforeAll(async () => {
    core = createDatabase(databaseUrl!);
    await migrate(core.db, { migrationsFolder: "./drizzle" });
    contacts = createClientConnection(databaseUrl!);
    workerConnection = createClientConnection(databaseUrl!, 1);
    repository = new PostgresClientRepository(contacts);
    worker = new ClientWorker(new PostgresClientRepository(workerConnection), logger);
    app = await createApp({ env, repositories: createPostgresRepositories(core.db), clients: repository });
  }, 20_000);
  afterEach(async () => {
    for (const owner of owners.splice(0)) {
      await core.client`delete from hotels where id = ${owner.id}`;
      await core.client`delete from users where id = ${owner.userId}`;
    }
  });
  afterAll(async () => { await app?.close(); await contacts?.end(); await workerConnection?.end(); await core?.client.end(); });

  const owner = async () => {
    const registration = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: `contacts-${randomUUID()}@example.com`, password: "a-strong-password", displayName: "Owner" } });
    expect(registration.statusCode).toBe(201);
    const token = registration.json().data.accessToken as string;
    const created = await app.inject({ method: "POST", url: "/v1/hotel", headers: auth(token), payload: { name: "Contact test hotel", city: "Firenze" } });
    expect(created.statusCode).toBe(201);
    const hotel = created.json().data.hotel;
    const result = { token, id: hotel.id as string, publicKey: hotel.publicKey as string, userId: registration.json().data.user.id as string };
    owners.push(result);
    await app.inject({ method: "PUT", url: "/v1/hotel/intake-settings", headers: auth(token), payload: { allowedOrigins: [origin] } });
    return result;
  };
  const request = async (hotel: Awaited<ReturnType<typeof owner>>, email = "guest@example.com", phone: string | null = "+393331234567") => {
    const response = await app.inject({ method: "POST", url: `/v1/public/hotels/${hotel.publicKey}/inquiries`, headers: { origin, "idempotency-key": randomUUID() }, payload: {
      guest: { name: "Anna Rossi", email, phone, language: "it" }, mealPlan: "BB", checkIn: "2027-01-10", checkOut: "2027-01-12", occupancy: { adults: 2, childAges: [] },
    } });
    expect(response.statusCode, response.body).toBe(202);
    return response.json().data.inquiryId as string;
  };
  const statuses = async (token: string, ids: string[]) => app.inject({ method: "POST", url: "/v1/clients/request-statuses", headers: auth(token), payload: { inquiryIds: ids } });
  const manual = (token: string, email = "guest@example.com", phone: string | null = null) => app.inject({ method: "POST", url: "/v1/clients", headers: auth(token), payload: { name: "Manual name", email, phone, locale: "it", notes: "VIP" } });

  const seedStay = async (hotel: Awaited<ReturnType<typeof owner>>, input: {
    email?: string; checkIn?: string; checkOut?: string; adults?: number; children?: number[];
    occupancies?: Array<{ adults: number; childrenAges: number[] }>; mealPlan?: string;
  } = {}) => {
    const id = randomUUID();
    await core.client`insert into inquiries (id, hotel_id, idempotency_key, guest_name, guest_email, locale, check_in, check_out, occupancies, meal_plan)
      values (${id}, ${hotel.id}, ${id}, 'Filter Guest', ${input.email ?? `${id}@example.com`}, 'en',
        ${input.checkIn ?? "2027-01-10"}, ${input.checkOut ?? "2027-01-12"},
        ${JSON.stringify(input.occupancies ?? [{ adults: input.adults ?? 2, childrenAges: input.children ?? [] }])}::jsonb, ${input.mealPlan ?? "BB"})`;
    const result = await repository.syncInquiry(hotel.id, id);
    return { id, clientId: result.client.id };
  };
  const filtered = async (hotel: Awaited<ReturnType<typeof owner>>, query: Record<string, string>) => {
    const response = await app.inject({ method: "GET", url: `/v1/clients?${new URLSearchParams(query)}`, headers: auth(hotel.token) });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data as { clients: Array<{ id: string; requestCount: number }>; nextCursor: string | null };
  };

  it("filters overlapping stays, counts all guests, and keeps combined conditions on the same reservation", async () => {
    const a = await owner(), b = await owner();
    const family = await seedStay(a, { children: [7], mealPlan: "HB" });
    const couple = await seedStay(a);
    const group = await seedStay(a, { occupancies: [{ adults: 2, childrenAges: [8] }, { adults: 1, childrenAges: [5] }] });
    await seedStay(b, { children: [7], mealPlan: "HB" });
    await seedStay(a, { email: "repeat@example.com", children: [7], mealPlan: "HB" });
    await seedStay(a, { email: "repeat@example.com", checkIn: "2027-02-10", checkOut: "2027-02-12", adults: 4 });
    expect((await filtered(a, { stayFrom: "2027-01-11", stayTo: "2027-01-11", minGuests: "3", maxGuests: "3", minAdults: "2", maxChildren: "1", mealPlan: "HB" })).clients.map((client) => client.id)).toContain(family.clientId);
    expect((await filtered(a, { minGuests: "5", maxGuests: "5", minAdults: "3", minChildren: "2" })).clients.map((client) => client.id)).toEqual([group.clientId]);
    expect((await filtered(a, { maxChildren: "0", stayTo: "2027-01-31" })).clients.map((client) => client.id)).toEqual([couple.clientId]);
    expect((await filtered(a, { stayFrom: "2027-01-12", stayTo: "2027-01-12" })).clients).toEqual([]);
    expect((await filtered(a, { stayFrom: "2027-01-12" })).clients).toHaveLength(1);
    expect((await filtered(a, { stayTo: "2027-01-09" })).clients).toEqual([]);
    expect((await filtered(a, { minNights: "3" })).clients).toEqual([]);
    expect((await filtered(a, { stayTo: "2027-01-31", minGuests: "4" })).clients.map((client) => client.id)).toEqual([group.clientId]);
    expect((await filtered(a, { minNights: "2", maxNights: "2", search: "repeat@example.com" })).clients).toHaveLength(1);
  });

  it("loads the contacts list and filter options without reading reservation tables", async () => {
    const hotel = await owner();
    const stay = await seedStay(hotel);
    let unlock!: () => void, locked!: () => void;
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const release = new Promise<void>((resolve) => { unlock = resolve; });
    const lock = core.client.begin(async (tx) => {
      await tx`lock table inquiries, offer_versions in access exclusive mode`;
      locked();
      await release;
    });
    await ready;
    try {
      expect((await filtered(hotel, {})).clients.map((client) => client.id)).toEqual([stay.clientId]);
      const options = await app.inject({ method: "GET", url: "/v1/clients/filter-options", headers: auth(hotel.token) });
      expect(options.statusCode, options.body).toBe(200);
    } finally { unlock(); await lock; }
  });

  it("matches the latest offer's selected room and status and scopes filter options to the hotel", async () => {
    const a = await owner(), b = await owner();
    const roomA = randomUUID(), roomB = randomUUID(), foreignRoom = randomUUID();
    for (const [id, hotelId, name] of [[roomA, a.id, "Original room"], [roomB, a.id, "Selected room"], [foreignRoom, b.id, "Foreign room"]]) {
      await core.client`insert into rooms (id, hotel_id, name, max_adults, max_guests) values (${id!}, ${hotelId!}, ${name!}, 2, 2)`;
    }
    const stay = await seedStay(a);
    const insertOffer = async (version: number, roomIds: string[], selected: number | null = null) => {
      const id = randomUUID();
      await core.client`insert into offer_versions (id, hotel_id, inquiry_id, version, public_token_hash, snapshot, expires_at, selected_option_index)
        values (${id}, ${a.id}, ${stay.id}, ${version}, ${id}, ${JSON.stringify({ options: roomIds.map((roomId) => ({ roomId })) })}::jsonb, now() + interval '1 day', ${selected})`;
      return id;
    };
    await insertOffer(1, [roomA]);
    const latest = await insertOffer(2, [roomA, roomB], 1);
    expect((await filtered(a, { roomId: roomB })).clients.map((client) => client.id)).toEqual([stay.clientId]);
    expect((await filtered(a, { roomId: roomA })).clients).toEqual([]);
    expect((await filtered(a, { roomId: foreignRoom })).clients).toEqual([]);
    expect((await filtered(a, { status: "new" })).clients).toHaveLength(1);
    await core.client`insert into deliveries (hotel_id, inquiry_id, offer_version_id, kind, channel, state, idempotency_key, recipient, payload)
      values (${a.id}, ${stay.id}, ${latest}, 'offer', 'email', 'delivered', ${latest}, 'guest@example.com', '{}')`;
    expect((await filtered(a, { status: "waiting" })).clients).toHaveLength(1);
    await core.client`update offer_versions set expires_at = now() - interval '1 day' where id = ${latest}`;
    expect((await filtered(a, { status: "attention" })).clients).toHaveLength(1);
    await core.client`update offer_versions set accepted_at = now() where id = ${latest}`;
    expect((await filtered(a, { status: "payment", roomId: roomB })).clients).toHaveLength(1);
    await core.client`update inquiries set closed_at = now() where id = ${stay.id}`;
    expect((await filtered(a, { status: "completed" })).clients).toHaveLength(1);
    expect((await filtered(a, { status: "payment" })).clients).toEqual([]);
    await core.client`update rooms set deleted_at = now() where id = ${roomB}`;
    const options = await app.inject({ method: "GET", url: "/v1/clients/filter-options", headers: auth(a.token) });
    expect(options.statusCode).toBe(200);
    expect(options.json().data.rooms).toEqual(expect.arrayContaining([{ id: roomB, name: "Selected room", archived: true }]));
    expect(options.json().data.rooms.some((room: { id: string }) => room.id === foreignRoom)).toBe(false);
    expect(options.json().data.locales).toEqual(["en"]);
    expect((await app.inject({ method: "GET", url: "/v1/clients/filter-options" })).statusCode).toBe(401);
  });

  it("filters contact details before pagination and rejects invalid filters", async () => {
    const hotel = await owner();
    for (let index = 0; index < 53; index++) {
      await repository.create(hotel.userId, { name: `Filtered ${index}`, email: `filter-${index}@example.com`, phone: null, locale: "it", notes: "VIP" });
    }
    const linked = await seedStay(hotel);
    const both = await repository.create(hotel.userId, { name: "Phone contact", email: "phone@example.com", phone: "+393331234567", locale: "de", notes: "" });
    const query = { source: "manual", locale: "it", notes: "with", reservations: "without", contact: "email", search: "Filtered" };
    const first = await filtered(hotel, query);
    expect(first.clients).toHaveLength(50);
    const second = await filtered(hotel, { ...query, cursor: first.nextCursor! });
    expect(second.clients).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.clients, ...second.clients].map((client) => client.id)).size).toBe(53);
    expect((await filtered(hotel, { source: "inquiry", reservations: "with" })).clients.map((client) => client.id)).toEqual([linked.clientId]);
    expect((await filtered(hotel, { contact: "both", notes: "without", locale: "de" })).clients.map((client) => client.id)).toEqual([both.client.id]);
    const [created] = await core.client`select created_at::date::text as date from clients where id = ${both.client.id}`;
    expect((await filtered(hotel, { locale: "de", addedFrom: created!.date, addedTo: created!.date })).clients).toHaveLength(1);
    expect((await filtered(hotel, { addedTo: "2000-01-01" })).clients).toEqual([]);
    for (const params of [{ stayFrom: "2027-02-30" }, { minGuests: "4", maxGuests: "2" }, { reservations: "without", status: "new" }, { minAdults: "-1" }]) {
      const response = await app.inject({ method: "GET", url: `/v1/clients?${new URLSearchParams(params)}`, headers: auth(hotel.token) });
      expect(response.statusCode, response.body).toBe(400);
    }
  });

  it("requires authentication, validates contacts, and isolates identical identities between companies", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/clients" })).statusCode).toBe(401);
    const a = await owner(), b = await owner();
    expect((await app.inject({ method: "POST", url: "/v1/clients", headers: auth(a.token), payload: { name: "No contact" } })).statusCode).toBe(422);
    const first = await manual(a.token), second = await manual(b.token);
    expect(first.statusCode).toBe(201); expect(second.statusCode).toBe(201);
    expect(first.json().data.client.id).not.toBe(second.json().data.client.id);
    const profile = await app.inject({ method: "GET", url: `/v1/clients/${first.json().data.client.id}`, headers: auth(a.token) });
    expect(profile.statusCode).toBe(200); expect(profile.json().data.client.name).toBe("Manual name");
    expect((await app.inject({ method: "GET", url: `/v1/clients/${second.json().data.client.id}`, headers: auth(a.token) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/clients/${first.json().data.client.id}` })).statusCode).toBe(401);
    const otherId = await request(b);
    expect((await statuses(a.token, [otherId])).json().data.statuses).toEqual([]);
    expect((await app.inject({ method: "POST", url: `/v1/inquiries/${otherId}/client`, headers: auth(a.token) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/clients/${second.json().data.client.id}/requests`, headers: auth(a.token) })).statusCode).toBe(404);
  });

  it("creates no contact in intake; background processing links repeat enquiries once and preserves snapshots", async () => {
    const hotel = await owner();
    const first = await request(hotel), second = await request(hotel);
    expect((await repository.list((owners[0]!).userId, "")).clients).toHaveLength(0);
    expect((await statuses(hotel.token, [first, second])).json().data.statuses.every((s: any) => !s.inContacts)).toBe(true);
    expect(await worker.processBatch()).toBe(2);
    const page = (await app.inject({ method: "GET", url: "/v1/clients", headers: auth(hotel.token) })).json().data;
    expect(page.clients).toHaveLength(1); expect(page.clients[0].requestCount).toBe(2);
    expect((await statuses(hotel.token, [first, second])).json().data.statuses.every((s: any) => s.inContacts)).toBe(true);
    const replay = await app.inject({ method: "POST", url: `/v1/inquiries/${first}/client`, headers: auth(hotel.token) });
    expect(replay.statusCode).toBe(200);
    const history = await app.inject({ method: "GET", url: `/v1/clients/${page.clients[0].id}/requests`, headers: auth(hotel.token) });
    expect(history.json().data.requests).toHaveLength(2);
    const [original] = await core.client`select guest_name, client_sync_pending from inquiries where id = ${first}`;
    expect(original).toEqual({ guest_name: "Anna Rossi", client_sync_pending: false });
  });

  it("recognises a manually created contact before linking and supports concurrent manual/background additions", async () => {
    const hotel = await owner(); const id = await request(hotel);
    const created = await manual(hotel.token, "GUEST@example.com"); expect(created.statusCode).toBe(201);
    expect((await statuses(hotel.token, [id])).json().data.statuses).toEqual([{ inquiryId: id, inContacts: true, clientId: created.json().data.client.id }]);
    await Promise.all([repository.syncInquiry(hotel.id, id), new PostgresClientRepository(workerConnection).syncInquiry(hotel.id, id)]);
    const page = await repository.list(hotel.userId, "");
    expect(page.clients).toHaveLength(1); expect(page.clients[0]).toMatchObject({ name: "Manual name", notes: "VIP", source: "manual", requestCount: 1 });
    expect((await manual(hotel.token)).statusCode).toBe(200);
  });

  it("leaves conflicting identities separate, persists failure and continues other requests", async () => {
    const hotel = await owner();
    await manual(hotel.token, "guest@example.com"); await manual(hotel.token, "different@example.com", "+393331234567");
    const conflict = await request(hotel); const good = await request(hotel, "good@example.com", "+393331234568");
    expect(await worker.processBatch()).toBe(1);
    const [failure] = await core.client`select attempt_count, last_error, client_id from client_request_sync where inquiry_id = ${conflict}`;
    expect(failure).toMatchObject({ attempt_count: 1, last_error: "CLIENT_IDENTITY_CONFLICT", client_id: null });
    const pending = await new PostgresClientRepository(workerConnection).pending(hotel.id, new Date(), 25);
    expect(pending).not.toContain(conflict);
    expect((await statuses(hotel.token, [good, conflict])).json().data.statuses).toEqual(expect.arrayContaining([expect.objectContaining({ inquiryId: conflict, inContacts: false, clientId: null }), expect.objectContaining({ inquiryId: good, inContacts: true, clientId: expect.any(String) })]));
    expect((await app.inject({ method: "POST", url: `/v1/inquiries/${conflict}/client`, headers: auth(hotel.token) })).statusCode).toBe(409);
  });

  it("backfills historical requests, limits batches and gives the next company a turn", async () => {
    const a = await owner(), b = await owner();
    await core.client`insert into inquiries (hotel_id, idempotency_key, guest_name, guest_email, locale, check_in, check_out, occupancies, created_at, meal_plan)
      select ${a.id}, 'bulk-' || n, 'Historical guest ' || n, 'bulk' || n || '@example.com', 'en', '2027-01-10', '2027-01-12', '[{"adults":2,"childrenAges":[]}]'::jsonb, now() - interval '7 days', 'BB' from generate_series(1, 300) n`;
    await request(b, "other@example.com", null);
    expect(await worker.processBatch()).toBeGreaterThan(0);
    expect(await worker.processBatch()).toBeGreaterThan(0);
    const [aCount] = await core.client`select count(*) from clients where hotel_id = ${a.id}`;
    const [bCount] = await core.client`select count(*) from clients where hotel_id = ${b.id}`;
    expect(Number(aCount!.count)).toBe(25); expect(Number(bCount!.count)).toBe(1);
    expect((await app.inject({ method: "GET", url: "/v1/dashboard", headers: auth(a.token) })).json().data.counts.total).toBe(0);
    const remaining = new ClientWorker(new PostgresClientRepository(workerConnection), logger);
    for (let i = 0; i < 11; i++) await remaining.processBatch();
    const page1 = await repository.list(a.userId, "");
    expect(page1.clients).toHaveLength(50); expect(page1.nextCursor).not.toBeNull();
    const page2 = await repository.list(a.userId, "", page1.nextCursor!);
    expect(page2.clients).toHaveLength(50); expect(page2.clients.some((c) => page1.clients.some((p) => p.id === c.id))).toBe(false);
    const historicalClient = (await repository.list(a.userId, "Historical guest 299")).clients[0]!;
    const history = await repository.history(a.userId, historicalClient.id);
    const detail = await app.inject({ method: "GET", url: `/v1/inquiries/${history.requests[0]!.id}`, headers: auth(a.token) });
    expect(detail.statusCode).toBe(200); expect(detail.json().data.inquiry.guestName).toBe("Historical guest 299");
    expect((await repository.list(b.userId, "Historical")).clients).toHaveLength(0);
  }, 20_000);

  it("paginates every client's reservations and opens historical details without crossing company boundaries", async () => {
    const a = await owner(), b = await owner();
    await core.client`insert into inquiries (hotel_id, idempotency_key, guest_name, guest_email, locale, check_in, check_out, occupancies, created_at, meal_plan)
      select ${a.id}, 'history-' || n, 'History Guest', 'history@example.com', 'en', '2027-01-10', '2027-01-12', '[{"adults":2,"childrenAges":[]}]'::jsonb,
        now() - interval '7 days' + n * interval '1 minute', 'BB' from generate_series(1, 26) n`;
    const unrelated = await request(a, "unrelated@example.com", null);
    const foreign = await request(b, "history@example.com", null);
    for (let i = 0; i < 3; i++) await worker.processBatch();
    const client = (await repository.list(a.userId, "history@example.com")).clients[0]!;
    expect(client.requestCount).toBe(26);
    const first = await app.inject({ method: "GET", url: `/v1/clients/${client.id}/requests`, headers: auth(a.token) });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.requests).toHaveLength(25);
    const second = await app.inject({ method: "GET", url: `/v1/clients/${client.id}/requests?cursor=${first.json().data.nextCursor}`, headers: auth(a.token) });
    expect(second.json().data.requests).toHaveLength(1);
    expect(second.json().data.nextCursor).toBeNull();
    const ids = [...first.json().data.requests, ...second.json().data.requests].map((item: { id: string }) => item.id);
    expect(new Set(ids).size).toBe(26);
    expect(ids).not.toContain(unrelated); expect(ids).not.toContain(foreign);
    const historicalId = second.json().data.requests[0].id;
    const detail = await app.inject({ method: "GET", url: `/v1/inquiries/${historicalId}`, headers: auth(a.token) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.inquiry).toMatchObject({ id: historicalId, guestEmail: "history@example.com", reservationNumber: expect.any(String) });
    const dashboard = await app.inject({ method: "GET", url: "/v1/dashboard", headers: auth(a.token) });
    expect(dashboard.json().data.inquiries.some((item: { id: string }) => item.id === historicalId)).toBe(false);
    expect((await app.inject({ method: "GET", url: `/v1/inquiries/${historicalId}`, headers: auth(b.token) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/clients/${client.id}/requests`, headers: auth(b.token) })).statusCode).toBe(404);
  });

  it("keeps intake, offers, acceptance and payment actions working while client tables are locked", async () => {
    const hotel = await owner();
    const room = await app.inject({ method: "POST", url: "/v1/rooms", headers: auth(hotel.token), payload: { name: "Double", maxAdults: 2, maxChildren: 0, maxGuests: 2, beds: [], amenities: [], photoUrls: [] } });
    expect(room.statusCode).toBe(201);
    const rate = await app.inject({ method: "POST", url: `/v1/rooms/${room.json().data.room.id}/rates`, headers: auth(hotel.token), payload: { planCode: "BB", planName: "Breakfast", mealPlan: "BB", start: "2027-01-01", endInclusive: "2027-12-31", nightlyBaseCents: 10000, includedAdults: 2, includedChildren: 0, extraAdultCents: 0, extraChildCents: 0, maxChildAge: 12, minNights: 1 } });
    expect(rate.statusCode, rate.body).toBe(201);
    let unlock!: () => void; let locked!: () => void;
    const ready = new Promise<void>((done) => { locked = done; });
    const release = new Promise<void>((done) => { unlock = done; });
    const lock = core.client.begin(async (tx) => { await tx`lock table clients in access exclusive mode`; locked(); await release; });
    await ready;
    try {
      const id = await request(hotel);
      const status = await statuses(hotel.token, [id]); expect(status.statusCode).toBe(500);
      expect(await worker.processBatch()).toBe(0);
      const dashboard = await app.inject({ method: "GET", url: "/v1/dashboard", headers: auth(hotel.token) });
      expect(dashboard.statusCode).toBe(200); expect(dashboard.json().data.counts.total).toBe(1);
      const [offer] = await core.client`select id from offer_versions where inquiry_id = ${id}`;
      expect(offer).toBeDefined();
      // Exercise the real acceptance route with a newly created offer's public token.
      const second = await app.inject({ method: "POST", url: `/v1/public/hotels/${hotel.publicKey}/inquiries`, headers: { origin, "idempotency-key": randomUUID() }, payload: { guest: { name: "Accepted Guest", email: "accept@example.com", phone: null, language: "it" }, mealPlan: "BB", checkIn: "2027-01-10", checkOut: "2027-01-12", occupancy: { adults: 2, childAges: [] } } });
      expect(second.statusCode).toBe(202);
      const token = second.json().data.proposalUrl.split("/").at(-1);
      const accepted = await app.inject({ method: "POST", url: `/v1/public/offers/${token}/accept`, payload: { option: 0 } });
      expect(accepted.statusCode, accepted.body).toBe(200);
      expect((await app.inject({ method: "POST", url: `/v1/inquiries/${second.json().data.inquiryId}/payment-link-sent`, headers: auth(hotel.token) })).statusCode).toBe(200);
    } finally { unlock(); await lock; }
  });
});
