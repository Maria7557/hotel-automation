import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db/client.js";
import { createPostgresRepositories } from "../src/repositories/postgres.js";
import { hashPublicToken } from "../src/lib/public-token.js";
import { PostgresClientRepository } from "../src/repositories/clients.js";
import { AUTOMATIC_SENDING_TIMEOUT_REASON } from "@hotel/contracts";

const databaseUrl = process.env.DASHBOARD_TEST_DATABASE_URL;
const env = { AUTH_SECRET: "dashboard-test-secret-that-is-at-least-32-characters", SESSION_TTL_DAYS: 30, corsOrigins: [] };
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
type Owner = { token: string; id: string; userId: string; dayStart: Date };
type Page = {
  hasRequests: boolean;
  counts: { total: number; new: number; offerSent: number; requiresConfirmation: number; requiresConfirmationTotalCents: number; needsAttention: number };
  pagination: { page: number; limit: number; total: number };
  inquiries: Array<{ id: string; reservationNumber: string; guestName: string; workflowState: string; offerSentAt: string | null; acceptedAt: string | null }>;
};

describe.skipIf(!databaseUrl)("dashboard PostgreSQL pagination", () => {
  let core: ReturnType<typeof createDatabase>;
  let app: FastifyInstance;
  const owners: Owner[] = [];
  beforeAll(async () => {
    core = createDatabase(databaseUrl!);
    await migrate(core.db, { migrationsFolder: "./drizzle" });
    app = await createApp({ env, repositories: createPostgresRepositories(core.db), clients: new PostgresClientRepository(core.client), logger: false });
  }, 20_000);
  afterEach(async () => {
    for (const owner of owners.splice(0)) {
      await core.client`delete from hotels where id = ${owner.id}`;
      await core.client`delete from users where id = ${owner.userId}`;
    }
  });
  afterAll(async () => { await app?.close(); await core?.client.end(); });

  async function owner(): Promise<Owner> {
    const registration = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: `dashboard-${randomUUID()}@example.com`, password: "a-strong-password" } });
    expect(registration.statusCode).toBe(201);
    const token = registration.json().data.accessToken as string;
    const created = await app.inject({ method: "POST", url: "/v1/hotel", headers: auth(token), payload: { name: "Dashboard Hotel", city: "Firenze" } });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.hotel.id as string;
    // Use a different calendar day from UTC to verify the hotel's timezone boundary.
    await core.client`update hotels set timezone = 'Pacific/Kiritimati' where id = ${id}`;
    const [clock] = await core.client`select date_trunc('day', now() at time zone 'Pacific/Kiritimati') at time zone 'Pacific/Kiritimati' as start`;
    const result = { token, id, userId: registration.json().data.user.id as string, dayStart: new Date(clock!.start) };
    owners.push(result);
    return result;
  }
  async function seed(owner: Owner, count: number, status: "new" | "waiting" | "payment" | "completed" | "attention" = "new", offset = 0) {
    const baseTime = status === "new" ? Math.max(owner.dayStart.getTime(), Date.now() - 5 * 60_000) : owner.dayStart.getTime();
    const rows = Array.from({ length: count }, (_, index) => ({
      id: randomUUID(), hotel_id: owner.id, idempotency_key: randomUUID(), guest_name: `${status} Guest ${index}`,
      guest_email: `${status}${index}@example.com`, locale: "it", check_in: "2027-01-10", check_out: "2027-01-12",
      occupancies: JSON.stringify([{ adults: 2, childrenAges: [] }]), meal_plan: "HB",
      // Pairs share a timestamp so the ID tie-breaker is exercised across page boundaries.
      created_at: new Date(baseTime + (offset + Math.floor(index / 2)) * 1000),
      closed_at: status === "completed" ? new Date() : null,
      attention_reason: status === "attention" ? "manual_review" : null,
    }));
    await core.client`insert into inquiries ${core.client(rows.map((row) => ({ ...row,
      created_at: row.created_at.toISOString(), closed_at: row.closed_at?.toISOString() ?? null })))}`;
    if (status === "waiting" || status === "payment") {
      for (const inquiry of rows) {
        const id = randomUUID();
        await core.client`insert into offer_versions (id, hotel_id, inquiry_id, version, state, public_token_hash, snapshot, expires_at, accepted_at, selected_option_index)
          values (${id}, ${owner.id}, ${inquiry.id}, 1, ${status === "payment" ? "accepted" : "active"}, ${randomUUID()},
            ${JSON.stringify({ options: [{ roomName: "Classic", totalCents: 10000, currency: "EUR", mealPlan: "HB" }, { roomName: "Suite", totalCents: 42000, currency: "EUR", mealPlan: "HB" }] })}::jsonb,
            now() + interval '7 days', ${status === "payment" ? new Date().toISOString() : null}, ${status === "payment" ? 1 : null})`;
        await core.client`update inquiries set current_offer_id = ${id} where id = ${inquiry.id}`;
        const sentAt = new Date(inquiry.created_at.getTime() + 100);
        await core.client`insert into deliveries (hotel_id, inquiry_id, offer_version_id, kind, channel, state, idempotency_key, recipient, payload, processed_at)
          values (${owner.id}, ${inquiry.id}, ${id}, 'offer', 'email', 'provider_accepted', ${randomUUID()}, ${inquiry.guest_email}, '{}'::jsonb, ${sentAt.toISOString()})`;
        await core.client`insert into deliveries (hotel_id, inquiry_id, offer_version_id, kind, channel, state, idempotency_key, recipient, payload, processed_at)
          values (${owner.id}, ${inquiry.id}, ${id}, 'offer', 'whatsapp', 'delivered', ${randomUUID()}, '+393331234567', '{}'::jsonb, ${new Date(sentAt.getTime() + 100).toISOString()})`;
      }
    }
    return rows.sort((left, right) => left.created_at.getTime() - right.created_at.getTime() || left.id.localeCompare(right.id));
  }
  async function page(owner: Owner, query: Record<string, string> = {}): Promise<Page> {
    const response = await app.inject({ method: "GET", url: `/v1/dashboard?${new URLSearchParams(query)}`, headers: auth(owner.token) });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    return response.json().data;
  }

  it("sorts all records before paging, keeps exact totals above 1,000, and isolates hotels and days", async () => {
    const hotel = await owner();
    const other = await owner();
    const empty = await page(hotel);
    expect(empty.pagination).toEqual({ page: 1, limit: 30, total: 0 });
    expect(empty.inquiries).toEqual([]);
    expect(empty.hasRequests).toBe(false);
    const rows = await seed(hotel, 1063);
    await seed(other, 7);
    await core.client`insert into inquiries (hotel_id, idempotency_key, guest_name, guest_email, locale, check_in, check_out, occupancies, meal_plan, created_at)
      values (${hotel.id}, ${randomUUID()}, 'Yesterday', 'yesterday@example.com', 'it', '2027-01-10', '2027-01-12', '[{"adults":2,"childrenAges":[]}]'::jsonb, 'HB', ${new Date(hotel.dayStart.getTime() - 1).toISOString()})`;
    const first = await page(hotel, { sort: "asc" });
    const second = await page(hotel, { sort: "asc", page: "2" });
    const descending = await page(hotel, { sort: "desc" });
    const last = await page(hotel, { sort: "asc", page: "36" });
    expect(first.counts.total).toBe(1063);
    expect(first.pagination).toEqual({ page: 1, limit: 30, total: 1063 });
    expect(first.inquiries.map(({ id }) => id)).toEqual(rows.slice(0, 30).map(({ id }) => id));
    expect(second.inquiries.map(({ id }) => id)).toEqual(rows.slice(30, 60).map(({ id }) => id));
    expect(descending.inquiries.map(({ id }) => id)).toEqual([...rows].reverse().slice(0, 30).map(({ id }) => id));
    expect(last.inquiries.map(({ id }) => id)).toEqual(rows.slice(1050).map(({ id }) => id));
    expect(last.pagination).toEqual({ page: 36, limit: 30, total: 1063 });
    expect((await page(hotel, { page: "100" })).pagination.page).toBe(36);
    expect((await page(other)).counts.total).toBe(7);
  });

  it("filters and searches before pagination while retaining dashboard totals and offer wait timestamps", async () => {
    const hotel = await owner();
    await seed(hotel, 40);
    const waiting = await seed(hotel, 40, "waiting", 100);
    const payment = await seed(hotel, 35, "payment", 200);
    await seed(hotel, 5, "completed", 300);
    await seed(hotel, 4, "attention", 400);
    const first = await page(hotel, { status: "payment", sort: "asc" });
    expect(first.pagination).toEqual({ page: 1, limit: 30, total: 35 });
    expect(first.inquiries.map(({ id }) => id)).toEqual(payment.slice(0, 30).map(({ id }) => id));
    expect(first.counts).toMatchObject({ total: 124, new: 40, offerSent: 40, requiresConfirmation: 35, requiresConfirmationTotalCents: 35 * 42000, needsAttention: 4 });
    const second = await page(hotel, { status: "payment", sort: "asc", page: "2" });
    expect(second.inquiries).toHaveLength(5);
    expect(second.counts).toEqual(first.counts);
    const replies = await page(hotel, { status: "waiting", sort: "asc" });
    expect(replies.pagination.total).toBe(40);
    expect(replies.inquiries[0]).toMatchObject({ id: waiting[0]!.id, workflowState: "offer_sent", offerSentAt: new Date(waiting[0]!.created_at.getTime() + 100).toISOString(), acceptedAt: null });
    expect((await page(hotel, { status: "waiting", search: "WAITING", sort: "asc", page: "2" })).inquiries).toHaveLength(10);
    const number = replies.inquiries[0]!.reservationNumber;
    expect((await page(hotel, { search: `#${number}` })).inquiries.map(({ id }) => id)).toEqual([waiting[0]!.id]);
    expect((await page(hotel, { search: "Suite" })).pagination.total).toBe(35);
    expect((await page(hotel, { status: "waiting", search: "2 adults" })).pagination.total).toBe(40);
    expect((await page(hotel, { status: "attention", search: "no match" })).pagination).toEqual({ page: 1, limit: 30, total: 0 });

    // Removing the remaining items on the last page returns the preceding page with a fresh count.
    for (const inquiry of payment.slice(30)) {
      const response = await app.inject({ method: "POST", url: `/v1/inquiries/${inquiry.id}/payment-link-sent`, headers: auth(hotel.token) });
      expect(response.statusCode).toBe(200);
    }
    const refilled = await page(hotel, { status: "payment", page: "2" });
    expect(refilled.pagination).toEqual({ page: 1, limit: 30, total: 30 });
    expect(refilled.inquiries).toHaveLength(30);
  });

  it("keeps SQL filters, counts, and detail summaries consistent for overdue automatic sending", async () => {
    const hotel = await owner();
    const pending = await seed(hotel, 3);
    const [fresh, queued, processing] = pending;
    for (const [inquiry, state] of [[queued!, "scheduled"], [processing!, "processing"]] as const) {
      const offerId = randomUUID();
      await core.client`insert into offer_versions (id, hotel_id, inquiry_id, version, state, public_token_hash, snapshot, expires_at, created_at)
        values (${offerId}, ${hotel.id}, ${inquiry.id}, 1, 'active', ${randomUUID()}, '{"options":[]}'::jsonb,
          now() + interval '7 days', now() - interval '16 minutes')`;
      await core.client`update inquiries set current_offer_id = ${offerId} where id = ${inquiry.id}`;
      await core.client`insert into deliveries (hotel_id, inquiry_id, offer_version_id, kind, channel, state, idempotency_key, recipient, payload)
        values (${hotel.id}, ${inquiry.id}, ${offerId}, 'offer', 'email', ${state}, ${randomUUID()}, ${inquiry.guest_email}, '{}'::jsonb)`;
    }
    const newPage = await page(hotel, { status: "new" });
    expect(newPage.counts).toMatchObject({ new: 1, needsAttention: 2 });
    expect(newPage.inquiries.map(({ id }) => id)).toEqual([fresh!.id]);
    const errors = await page(hotel, { status: "attention" });
    expect(errors.pagination.total).toBe(2);
    expect(errors.inquiries).toEqual(expect.arrayContaining([queued, processing].map((inquiry) => expect.objectContaining({ id: inquiry!.id, workflowState: "needs_attention", attentionReason: AUTOMATIC_SENDING_TIMEOUT_REASON }))));
    for (const inquiry of [queued!, processing!]) {
      const detail = await app.inject({ method: "GET", url: `/v1/inquiries/${inquiry.id}`, headers: auth(hotel.token) });
      expect(detail.json().data.inquiry).toMatchObject({ workflowState: "needs_attention", attentionReason: AUTOMATIC_SENDING_TIMEOUT_REASON });
    }
    // Creating a new offer version restarts the window; the old delivery does not decide its status.
    await core.client`insert into offer_versions (hotel_id, inquiry_id, version, state, public_token_hash, snapshot, expires_at)
      values (${hotel.id}, ${queued!.id}, 2, 'active', ${randomUUID()}, '{"options":[]}'::jsonb, now() + interval '7 days')`;
    expect((await page(hotel, { status: "new" })).inquiries.map(({ id }) => id)).toContain(queued!.id);
  });

  it("finds prior-day reservations by exact number and text without changing today's incoming total", async () => {
    const hotel = await owner(), other = await owner();
    await seed(hotel, 2);
    const [old] = await seed(hotel, 1, "completed");
    await core.client`update inquiries set created_at = ${new Date(hotel.dayStart.getTime() - 1).toISOString()}, guest_name = 'Previous day guest' where id = ${old!.id}`;
    const detail = await app.inject({ method: "GET", url: `/v1/inquiries/${old!.id}`, headers: auth(hotel.token) });
    expect(detail.statusCode).toBe(200);
    const number = detail.json().data.inquiry.reservationNumber as string;
    expect((await page(hotel)).pagination.total).toBe(2);
    for (const search of [number, `#${number}`, "Previous day guest"]) {
      const result = await page(hotel, { search });
      expect(result.inquiries.map(({ id }) => id)).toEqual([old!.id]);
      expect(result.counts.total).toBe(2);
      expect(result.pagination.total).toBe(1);
    }
    expect((await page(other, { search: number })).inquiries).toEqual([]);
    expect((await page(hotel, { search: number, status: "payment" })).inquiries).toEqual([]);
    expect((await page(hotel)).pagination.total).toBe(2);
  });

  it("retains prior-day actionable work and counts across midnight, separately from today's list", async () => {
    const hotel = await owner(), other = await owner();
    const [today] = await seed(hotel, 1);
    const prior = [
      ...(await seed(hotel, 2, "payment")),
      ...(await seed(hotel, 2, "attention")),
      ...(await seed(hotel, 1, "waiting")),
      ...(await seed(hotel, 1, "completed")),
    ];
    for (const row of prior) await core.client`update inquiries set created_at = ${new Date(hotel.dayStart.getTime() - 1).toISOString()} where id = ${row.id}`;
    await seed(other, 3, "payment");
    const incoming = await page(hotel);
    expect(incoming.inquiries.map(({ id }) => id)).toEqual([today!.id]);
    expect(incoming.counts).toMatchObject({ total: 1, new: 1, offerSent: 0, requiresConfirmation: 2, requiresConfirmationTotalCents: 84000, needsAttention: 2 });
    const actions = await page(hotel, { scope: "actions" });
    expect(actions.pagination.total).toBe(5);
    expect(actions.counts).toEqual(incoming.counts);
    expect((await page(hotel, { scope: "actions", status: "payment" })).pagination.total).toBe(2);
    expect((await page(hotel, { scope: "actions", status: "attention" })).pagination.total).toBe(2);
    expect((await page(hotel, { status: "payment" })).pagination.total).toBe(0);
    expect((await page(hotel, { scope: "actions", status: "waiting" })).pagination.total).toBe(0);
    expect((await page(other, { scope: "actions" })).pagination.total).toBe(3);
  });

  it("surfaces an offer accepted after midnight in To do while keeping client history and the daily total", async () => {
    const hotel = await owner();
    const [inquiry] = await seed(hotel, 1, "waiting");
    const beforeMidnight = new Date(hotel.dayStart.getTime() - 60_000).toISOString();
    await core.client`update inquiries set created_at = ${beforeMidnight} where id = ${inquiry!.id}`;
    const token = randomUUID();
    await core.client`update offer_versions set created_at = ${beforeMidnight}, public_token_hash = ${hashPublicToken(token)} where inquiry_id = ${inquiry!.id}`;
    const added = await app.inject({ method: "POST", url: `/v1/inquiries/${inquiry!.id}/client`, headers: auth(hotel.token) });
    expect(added.statusCode, added.body).toBe(201);
    const clientId = added.json().data.client.id as string;
    const history = () => app.inject({ method: "GET", url: `/v1/clients/${clientId}/requests`, headers: auth(hotel.token) });
    expect((await history()).json().data.requests.map(({ id }: { id: string }) => id)).toEqual([inquiry!.id]);
    const accepted = await app.inject({ method: "POST", url: `/v1/public/offers/${token}/accept`, payload: { option: 1 } });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(Date.parse(accepted.json().data.offer.acceptedAt)).toBeGreaterThanOrEqual(hotel.dayStart.getTime());
    const detail = await app.inject({ method: "GET", url: `/v1/inquiries/${inquiry!.id}`, headers: auth(hotel.token) });
    expect(detail.json().data.inquiry.workflowState).toBe("requires_confirmation");
    expect((await history()).json().data.requests.map(({ id }: { id: string }) => id)).toEqual([inquiry!.id]);
    const incoming = await page(hotel);
    expect(incoming.pagination.total).toBe(0);
    expect(incoming.hasRequests).toBe(true);
    expect(incoming.counts).toMatchObject({ total: 0, requiresConfirmation: 1, requiresConfirmationTotalCents: 42000 });
    const payment = await page(hotel, { scope: "actions", status: "payment" });
    expect(payment.inquiries.map(({ id }) => id)).toEqual([inquiry!.id]);
    const closed = await app.inject({ method: "POST", url: `/v1/inquiries/${inquiry!.id}/payment-link-sent`, headers: auth(hotel.token) });
    expect(closed.statusCode).toBe(200);
    const emptyActions = await page(hotel, { scope: "actions" });
    expect(emptyActions.pagination.total).toBe(0);
    expect(emptyActions.hasRequests).toBe(true);
    const number = detail.json().data.inquiry.reservationNumber as string;
    expect((await page(hotel, { search: `#${number}` })).inquiries.map(({ id }) => id)).toEqual([inquiry!.id]);
    expect((await history()).json().data.requests).toHaveLength(1);
    // Synthetic fixture has no connected delivery providers or push devices, and no worker is started.
  });

  it("pages prior-day actions before limiting, then refills the last page after completion", async () => {
    const hotel = await owner();
    const old = await seed(hotel, 35, "payment");
    for (const [index, inquiry] of old.entries()) {
      await core.client`update inquiries set created_at = ${new Date(hotel.dayStart.getTime() - (old.length - index) * 1000).toISOString()} where id = ${inquiry.id}`;
    }
    const first = await page(hotel, { scope: "actions", status: "payment", sort: "asc" });
    const last = await page(hotel, { scope: "actions", status: "payment", sort: "asc", page: "2" });
    expect(first.counts).toMatchObject({ total: 0, requiresConfirmation: 35 });
    expect(first.inquiries.map(({ id }) => id)).toEqual(old.slice(0, 30).map(({ id }) => id));
    expect(last.inquiries.map(({ id }) => id)).toEqual(old.slice(30).map(({ id }) => id));
    for (const inquiry of old.slice(30)) {
      const closed = await app.inject({ method: "POST", url: `/v1/inquiries/${inquiry.id}/payment-link-sent`, headers: auth(hotel.token) });
      expect(closed.statusCode).toBe(200);
    }
    const refilled = await page(hotel, { scope: "actions", status: "payment", page: "2" });
    expect(refilled.pagination).toEqual({ page: 1, limit: 30, total: 30 });
    expect(refilled.counts).toMatchObject({ total: 0, requiresConfirmation: 30 });
  });

  it("keeps a freshly resent offer on a prior-day inquiry in New with its processing timer", async () => {
    const hotel = await owner();
    const [inquiry] = await seed(hotel, 1);
    await core.client`update inquiries set created_at = ${new Date(hotel.dayStart.getTime() - 1).toISOString()} where id = ${inquiry!.id}`;
    await core.client`insert into offer_versions (hotel_id, inquiry_id, version, state, public_token_hash, snapshot, expires_at)
      values (${hotel.id}, ${inquiry!.id}, 1, 'active', ${randomUUID()}, '{"options":[]}'::jsonb, now() + interval '7 days')`;
    const response = await app.inject({ method: "GET", url: "/v1/dashboard?scope=actions&status=new", headers: auth(hotel.token) });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.inquiries.map(({ id }: { id: string }) => id)).toEqual([inquiry!.id]);
    expect(response.json().data.counts).toMatchObject({ total: 0, new: 1, needsAttention: 0 });
    expect(Date.parse(response.json().data.nextProcessingDeadlineAt)).toBeGreaterThan(Date.now());
    expect((await page(hotel)).pagination.total).toBe(0);
  });

  it("validates paging, sorting, and filters and treats search wildcards literally", async () => {
    const hotel = await owner();
    const [inquiry] = await seed(hotel, 1);
    await core.client`update inquiries set guest_name = '100% Guest_name' where id = ${inquiry!.id}`;
    expect((await page(hotel, { search: "100%" })).inquiries).toHaveLength(1);
    expect((await page(hotel, { search: "Guest_" })).inquiries).toHaveLength(1);
    expect((await page(hotel, { search: "%missing" })).inquiries).toHaveLength(0);
    for (const query of ["page=0", "page=-1", "page=1.5", "limit=31", "limit=0", "sort=invalid", "status=invalid", "scope=invalid", "unexpected=1"]) {
      const response = await app.inject({ method: "GET", url: `/v1/dashboard?${query}`, headers: auth(hotel.token) });
      expect(response.statusCode, query).toBe(400);
    }
    expect((await app.inject({ method: "GET", url: "/v1/dashboard" })).statusCode).toBe(401);
  });
});
