import type { ClientFilters, ClientFilterOptions, MealPlan } from "@hotel/contracts";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { AppError, errors } from "../lib/errors.js";
import { clientIdentity, clientMatch, ensureClientIdentity, type ClientInput } from "../services/client-identity.js";

type Connection = Sql | TransactionSql;
type Row = Record<string, any>;
export type ClientProfile = {
  id: string; name: string; email: string | null; phone: string | null; locale: string;
  notes: string; source: "manual" | "inquiry"; firstInquiryAt: string | null;
  lastInquiryAt: string | null; createdAt: string; requestCount: number;
};
export interface ClientRepository {
  find(userId: string, clientId: string): Promise<ClientProfile>;
  list(userId: string, search: string, cursor?: string, filters?: ClientFilters): Promise<{ clients: ClientProfile[]; nextCursor: string | null }>;
  filterOptions(userId: string): Promise<ClientFilterOptions>;
  create(userId: string, input: ClientInput): Promise<{ client: ClientProfile; created: boolean }>;
  statuses(userId: string, ids: string[]): Promise<Array<{ inquiryId: string; inContacts: boolean; clientId: string | null }>>;
  addFromInquiry(userId: string, inquiryId: string): Promise<{ client: ClientProfile; created: boolean }>;
  history(userId: string, clientId: string, cursor?: string): Promise<{ requests: Array<{ id: string; mealPlan: MealPlan | null; checkIn: string; checkOut: string; createdAt: string }>; nextCursor: string | null }>;
}

export function createClientConnection(url: string, max = 2) {
  return postgres(url, {
    max, idle_timeout: 20, connect_timeout: 2, prepare: false,
    connection: { application_name: "hotel-contacts", statement_timeout: 1500, lock_timeout: 100, idle_in_transaction_session_timeout: 3000 },
  });
}

function profile(row: Row): ClientProfile {
  const iso = (value: any) => value ? new Date(value).toISOString() : null;
  return {
    id: row.id, name: row.name, email: row.email, phone: row.phone, locale: row.locale,
    notes: row.notes, source: row.source, firstInquiryAt: iso(row.first_inquiry_at),
    lastInquiryAt: iso(row.last_inquiry_at), createdAt: iso(row.created_at)!, requestCount: Number(row.request_count ?? 0),
  };
}

export class PostgresClientRepository implements ClientRepository {
  constructor(readonly db: Sql) {}

  async find(userId: string, clientId: string) {
    const hotelId = await this.hotel(userId);
    const [row] = await this.db`select c.*, (select count(*) from client_request_sync s where s.hotel_id = c.hotel_id and s.client_id = c.id) as request_count
      from clients c where c.hotel_id = ${hotelId} and c.id = ${clientId}`;
    if (!row) throw new AppError(404, "CLIENT_NOT_FOUND", "Client was not found.");
    return profile(row);
  }

  private async hotel(userId: string): Promise<string> {
    const [row] = await this.db`select h.id from hotels h join hotel_members m on m.hotel_id = h.id where m.user_id = ${userId} and h.deleted_at is null limit 1`;
    if (!row) throw errors.hotelNotFound();
    return row.id;
  }

  async filterOptions(userId: string): Promise<ClientFilterOptions> {
    const hotelId = await this.hotel(userId);
    const rooms = await this.db`select id, name, deleted_at is not null or not active as archived from rooms where hotel_id = ${hotelId} order by name, id`;
    const locales = await this.db`select distinct locale from clients where hotel_id = ${hotelId} order by locale`;
    return {
      rooms: rooms.map((row) => ({ id: row.id as string, name: row.name as string, archived: Boolean(row.archived) })),
      locales: locales.map((row) => row.locale as string),
    };
  }

  async list(userId: string, search: string, cursor?: string, filters: ClientFilters = {}) {
    const hotelId = await this.hotel(userId);
    const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    const stayFilters = [filters.stayFrom, filters.stayTo, filters.minGuests, filters.maxGuests,
      filters.minAdults, filters.maxAdults, filters.minChildren, filters.maxChildren,
      filters.minNights, filters.maxNights, filters.roomId, filters.mealPlan, filters.status];
    const hasStayFilters = stayFilters.some((value) => value !== undefined);
    // One EXISTS keeps every reservation condition on the same stay and avoids duplicate contacts.
    // The default contacts query never reads inquiry/offer rows.
    const reservationCondition = hasStayFilters ? this.db`exists (
      select 1 from client_request_sync s
      join inquiries i on i.id = s.inquiry_id and i.hotel_id = s.hotel_id
      ${filters.roomId || filters.status ? this.db`left join lateral (
        select o.* from offer_versions o where o.inquiry_id = i.id and o.hotel_id = i.hotel_id order by o.version desc limit 1
      ) o on true` : this.db``}
      where s.hotel_id = c.hotel_id and s.client_id = c.id
      ${filters.stayFrom !== undefined ? this.db`and i.check_out > ${filters.stayFrom}::date` : this.db``}
      ${filters.stayTo !== undefined ? this.db`and i.check_in <= ${filters.stayTo}::date` : this.db``}
      ${filters.minGuests !== undefined || filters.maxGuests !== undefined || filters.minAdults !== undefined || filters.maxAdults !== undefined || filters.minChildren !== undefined || filters.maxChildren !== undefined ? this.db`and exists (
        select 1 from (
          select coalesce(sum((occupancy->>'adults')::int), 0) as adults,
            coalesce(sum(jsonb_array_length(coalesce(occupancy->'childrenAges', '[]'::jsonb))), 0) as children
          from jsonb_array_elements(i.occupancies) occupancy
        ) guests where true
        ${filters.minGuests !== undefined ? this.db`and guests.adults + guests.children >= ${filters.minGuests}` : this.db``}
        ${filters.maxGuests !== undefined ? this.db`and guests.adults + guests.children <= ${filters.maxGuests}` : this.db``}
        ${filters.minAdults !== undefined ? this.db`and guests.adults >= ${filters.minAdults}` : this.db``}
        ${filters.maxAdults !== undefined ? this.db`and guests.adults <= ${filters.maxAdults}` : this.db``}
        ${filters.minChildren !== undefined ? this.db`and guests.children >= ${filters.minChildren}` : this.db``}
        ${filters.maxChildren !== undefined ? this.db`and guests.children <= ${filters.maxChildren}` : this.db``}
      )` : this.db``}
      ${filters.minNights !== undefined ? this.db`and i.check_out - i.check_in >= ${filters.minNights}` : this.db``}
      ${filters.maxNights !== undefined ? this.db`and i.check_out - i.check_in <= ${filters.maxNights}` : this.db``}
      ${filters.mealPlan ? this.db`and i.meal_plan = ${filters.mealPlan}` : this.db``}
      ${filters.roomId ? this.db`and (o.snapshot->'options'->coalesce(o.selected_option_index, 0)->>'roomId') = ${filters.roomId}` : this.db``}
      ${filters.status ? this.db`and (case
        when i.closed_at is not null then 'completed'
        when o.accepted_at is not null then 'payment'
        when i.attention_reason is not null then 'attention'
        when o.state in ('expired', 'revoked') or o.expires_at <= now() then 'attention'
        when o.id is not null and exists (select 1 from deliveries d where d.hotel_id = i.hotel_id and d.inquiry_id = i.id and d.offer_version_id = o.id and d.state in ('provider_accepted', 'delivered')) then 'waiting'
        else 'new' end) = ${filters.status}` : this.db``}
    )` : this.db`true`;
    const rows = await this.db`
      select c.*, (select count(*) from client_request_sync s where s.hotel_id = c.hotel_id and s.client_id = c.id) as request_count
      from clients c where c.hotel_id = ${hotelId}
      and (${!search} or c.name ilike ${pattern} or c.email ilike ${pattern} or c.phone ilike ${pattern})
      ${filters.source ? this.db`and c.source = ${filters.source}` : this.db``}
      ${filters.locale ? this.db`and c.locale = ${filters.locale}` : this.db``}
      ${filters.contact === "email" || filters.contact === "both" ? this.db`and nullif(btrim(c.email), '') is not null` : this.db``}
      ${filters.contact === "phone" || filters.contact === "both" ? this.db`and nullif(btrim(c.phone), '') is not null` : this.db``}
      ${filters.notes ? this.db`and (nullif(btrim(c.notes), '') is not null) = ${filters.notes === "with"}` : this.db``}
      ${filters.addedFrom ? this.db`and c.created_at >= ${filters.addedFrom}::date::timestamp at time zone 'UTC'` : this.db``}
      ${filters.addedTo ? this.db`and c.created_at < (${filters.addedTo}::date + 1)::timestamp at time zone 'UTC'` : this.db``}
      ${filters.reservations ? this.db`and exists (select 1 from client_request_sync s where s.hotel_id = c.hotel_id and s.client_id = c.id) = ${filters.reservations === "with"}` : this.db``}
      and ${reservationCondition}
      and (${!cursor} or (c.created_at, c.id) < (select created_at, id from clients where hotel_id = ${hotelId} and id = ${cursor ?? null}::uuid))
      order by c.created_at desc, c.id desc limit 51`;
    return { clients: rows.slice(0, 50).map(profile), nextCursor: rows.length > 50 ? rows[49]!.id as string : null };
  }

  async create(userId: string, input: ClientInput) {
    const hotelId = await this.hotel(userId);
    return this.retryUnique(() => this.db.begin(async (tx) => this.upsert(tx, hotelId, input, null)));
  }

  // Both user actions and the worker use the same atomic, idempotent linking operation.
  async addFromInquiry(userId: string, inquiryId: string) {
    return this.syncInquiry(await this.hotel(userId), inquiryId);
  }

  async syncInquiry(hotelId: string, inquiryId: string) {
    const result = await this.retryUnique(() => this.db.begin(async (tx) => {
      const [request] = await tx`select * from inquiries where hotel_id = ${hotelId} and id = ${inquiryId}`;
      if (!request) throw new AppError(404, "INQUIRY_NOT_FOUND", "Request was not found.");
      const [linked] = await tx`select c.* from client_request_sync s join clients c on c.id = s.client_id and c.hotel_id = s.hotel_id where s.inquiry_id = ${inquiryId} and s.hotel_id = ${hotelId}`;
      if (linked) return { client: profile(linked), created: false };
      const contact = await this.upsert(tx, hotelId, {
        name: request.guest_name, email: request.guest_email, phone: request.guest_phone, locale: request.locale, notes: "",
      }, request.created_at);
      await tx`insert into client_request_sync (inquiry_id, hotel_id, client_id) values (${inquiryId}, ${hotelId}, ${contact.client.id})
        on conflict (inquiry_id) do update set client_id = excluded.client_id, last_error = null, updated_at = now()`;
      return contact;
    }));
    // A separate, tiny acknowledgement. Never hold a request lock during contact work.
    // If a core action holds the row, skip it; the next pass acknowledges the existing link.
    await this.db`update inquiries set client_sync_pending = false where id in
      (select id from inquiries where id = ${inquiryId} and hotel_id = ${hotelId} and client_sync_pending = true for update skip locked)`
      .catch(() => undefined);
    return result;
  }

  private async upsert(tx: Connection, hotelId: string, input: ClientInput, inquiryAt: Date | null) {
    const identity = ensureClientIdentity(input);
    const matches = await tx`select * from clients where hotel_id = ${hotelId} and
      (normalized_email = ${identity.normalizedEmail} or normalized_phone = ${identity.normalizedPhone}) for update`;
    const match = clientMatch(matches.map((row) => ({ ...row, id: row.id as string, normalizedEmail: row.normalized_email as string | null, normalizedPhone: row.normalized_phone as string | null })), identity);
    if (match) {
      const [row] = await tx`update clients set
        email = coalesce(email, ${input.email}),
        phone = case when normalized_phone is null and ${identity.normalizedPhone}::text is not null then ${input.phone} else coalesce(phone, ${input.phone}) end,
        normalized_email = coalesce(normalized_email, ${identity.normalizedEmail}),
        normalized_phone = coalesce(normalized_phone, ${identity.normalizedPhone}),
        first_inquiry_at = case when ${inquiryAt}::timestamptz is null then first_inquiry_at else least(first_inquiry_at, ${inquiryAt}::timestamptz) end,
        last_inquiry_at = case when ${inquiryAt}::timestamptz is null then last_inquiry_at else greatest(last_inquiry_at, ${inquiryAt}::timestamptz) end,
        updated_at = now() where id = ${match.id} and hotel_id = ${hotelId} returning *`;
      return { client: profile(row!), created: false };
    }
    const [row] = await tx`insert into clients (hotel_id, name, email, phone, normalized_email, normalized_phone, locale, notes, source, first_inquiry_at, last_inquiry_at)
      values (${hotelId}, ${input.name}, ${input.email}, ${input.phone}, ${identity.normalizedEmail}, ${identity.normalizedPhone}, ${input.locale}, ${input.notes}, ${inquiryAt ? "inquiry" : "manual"}, ${inquiryAt}, ${inquiryAt}) returning *`;
    return { client: profile(row!), created: true };
  }

  private async retryUnique<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "23505") return operation();
      throw error;
    }
  }

  async statuses(userId: string, ids: string[]) {
    const hotelId = await this.hotel(userId);
    const requests = await this.db`select i.id, i.guest_email, i.guest_phone, s.client_id from inquiries i
      left join client_request_sync s on s.inquiry_id = i.id and s.hotel_id = i.hotel_id
      where i.hotel_id = ${hotelId} and i.id in ${this.db(ids)}`;
    // One batched identity lookup; manually created contacts are recognised before the worker links them.
    const identities = requests.map((r) => clientIdentity({ email: r.guest_email, phone: r.guest_phone }));
    const emails = identities.flatMap((i) => i.normalizedEmail ? [i.normalizedEmail] : []);
    const phones = identities.flatMap((i) => i.normalizedPhone ? [i.normalizedPhone] : []);
    const matches = emails.length || phones.length ? await this.db`select id, normalized_email, normalized_phone from clients where hotel_id = ${hotelId}
      and (normalized_email = any(${emails}::text[]) or normalized_phone = any(${phones}::text[]))` : [];
    return requests.map((request, index) => {
      const identity = identities[index]!;
      const candidates = matches.filter((c) => (identity.normalizedEmail && c.normalized_email === identity.normalizedEmail) || (identity.normalizedPhone && c.normalized_phone === identity.normalizedPhone));
      let clientId = request.client_id as string | null;
      try { clientId ??= clientMatch(candidates.map((c) => ({ id: c.id as string, normalizedEmail: c.normalized_email, normalizedPhone: c.normalized_phone })), identity)?.id ?? null; } catch { /* Conflicting identities are not silently merged. */ }
      return { inquiryId: request.id as string, inContacts: Boolean(clientId), clientId };
    });
  }

  async history(userId: string, clientId: string, cursor?: string) {
    const hotelId = await this.hotel(userId);
    const [contact] = await this.db`select id from clients where hotel_id = ${hotelId} and id = ${clientId}`;
    if (!contact) throw new AppError(404, "CLIENT_NOT_FOUND", "Client was not found.");
    const rows = await this.db`select i.id, i.meal_plan, i.check_in::text, i.check_out::text, i.created_at from client_request_sync s
      join inquiries i on i.id = s.inquiry_id and i.hotel_id = s.hotel_id
      where s.hotel_id = ${hotelId} and s.client_id = ${clientId}
      and (${!cursor} or (i.created_at, i.id) < (select created_at, id from inquiries where hotel_id = ${hotelId} and id = ${cursor ?? null}::uuid))
      order by i.created_at desc, i.id desc limit 26`;
    return { requests: rows.slice(0, 25).map((r) => ({ id: r.id as string, mealPlan: r.meal_plan as MealPlan | null, checkIn: r.check_in as string, checkOut: r.check_out as string, createdAt: new Date(r.created_at).toISOString() })), nextCursor: rows.length > 25 ? rows[24]!.id as string : null };
  }

  async nextHotel(now: Date): Promise<string | null> {
    const [row] = await this.db`select h.id from hotels h left join client_worker_hotels w on w.hotel_id = h.id
      where h.deleted_at is null and exists (select 1 from inquiries i left join client_request_sync s on s.inquiry_id = i.id
        where i.hotel_id = h.id and i.client_sync_pending = true and (s.inquiry_id is null or s.client_id is not null or s.next_attempt_at <= ${now}))
      order by w.last_run_at asc nulls first, h.id limit 1`;
    if (!row) return null;
    await this.db`insert into client_worker_hotels (hotel_id, last_run_at) values (${row.id}, ${now}) on conflict (hotel_id) do update set last_run_at = excluded.last_run_at`;
    return row.id;
  }

  async pending(hotelId: string, now: Date, limit: number): Promise<string[]> {
    const rows = await this.db`select i.id from inquiries i left join client_request_sync s on s.inquiry_id = i.id
      where i.hotel_id = ${hotelId} and i.client_sync_pending = true and (s.inquiry_id is null or s.client_id is not null or s.next_attempt_at <= ${now})
      order by i.created_at, i.id limit ${limit}`;
    return rows.map((r) => r.id as string);
  }

  async recordFailure(hotelId: string, inquiryId: string, now: Date, code: string) {
    await this.db`insert into client_request_sync (inquiry_id, hotel_id, attempt_count, next_attempt_at, last_error)
      values (${inquiryId}, ${hotelId}, 1, ${new Date(now.getTime() + 60_000)}, ${code})
      on conflict (inquiry_id) do update set attempt_count = client_request_sync.attempt_count + 1,
      next_attempt_at = ${now}::timestamptz + least(21600, 60 * power(2, least(client_request_sync.attempt_count, 9))) * interval '1 second',
      last_error = excluded.last_error, updated_at = now() where client_request_sync.client_id is null`;
  }
}
