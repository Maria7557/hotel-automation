import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, sql } from "drizzle-orm";
import type { DashboardQuery, MealPlan } from "@hotel/contracts";

import type { Database } from "../db/client.js";
import {
  authSessions,
  connections,
  deliveries,
  hotelMessageSettings,
  hotelMembers,
  hotels,
  inquiries,
  notificationPreferences,
  offerVersions,
  pushDevices,
  ratePeriods,
  rooms,
  users,
} from "../db/schema.js";
import type {
  AutomationRepository,
  AuthRepository,
  ChannelRepository,
  ClaimedOfferDelivery,
  ConnectionKind,
  ConnectionRecord,
  DeliveryWorkerRepository,
  DashboardFacts,
  DashboardPageFacts,
  DeliveryRecord,
  HotelCreate,
  HotelProfile,
  HotelRepository,
  HotelUpdate,
  InventoryRepository,
  InquiryBundle,
  InquiryBundleCreate,
  InquiryRecord,
  MessageSettings,
  MessageSettingsUpdate,
  NotificationPreferences,
  NotificationRepository,
  OfferRecord,
  ReservationOffersCreate,
  PlatformAdminRepository,
  RatePeriodCreate,
  RatePeriodProfile,
  RatePeriodUpdate,
  Repositories,
  RoomCreate,
  RoomProfile,
  RoomUpdate,
  PushDeviceRecord,
  SystemRepository,
  SocialProvider,
  UserRecord,
  WhatsAppSupportRecord,
} from "./types.js";
import { errors } from "../lib/errors.js";

function requireRow<T>(rows: T[], operation: string): T {
  const row = rows[0];
  if (!row) throw new Error(`Database did not return a row for ${operation}.`);
  return row;
}

function mapUser(row: typeof users.$inferSelect): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    googleSubject: row.googleSubject,
    appleSubject: row.appleSubject,
  };
}

function mapHotel(row: typeof hotels.$inferSelect): HotelProfile {
  return {
    id: row.id,
    publicKey: row.publicKey,
    allowedOrigins: row.allowedOrigins,
    name: row.name,
    city: row.city,
    countryCode: row.countryCode,
    locale: row.locale,
    description: row.description,
    currency: row.currency,
    timezone: row.timezone,
    email: row.email,
    phone: row.phone,
    website: row.website,
    logoUrl: row.logoUrl,
    photoUrls: row.photoUrls,
    termsText: row.termsText,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapInquiry(row: typeof inquiries.$inferSelect): InquiryRecord {
  const occupancy = row.occupancies[0] ?? { adults: 1, childrenAges: [] };
  return {
    id: row.id,
    reservationNumber: row.reservationNumber.toString(),
    hotelId: row.hotelId,
    idempotencyKey: row.idempotencyKey,
    guestName: row.guestName,
    guestEmail: row.guestEmail,
    guestPhone: row.guestPhone,
    locale: row.locale,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    occupancy: { adults: occupancy.adults, childAges: occupancy.childrenAges },
    mealPlan: row.mealPlan as MealPlan | null,
    source: row.source,
    note: row.note,
    attentionReason: row.attentionReason as InquiryRecord["attentionReason"],
    currentOfferId: row.currentOfferId,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapOffer(row: typeof offerVersions.$inferSelect): OfferRecord {
  return { ...row };
}

function mapDelivery(row: typeof deliveries.$inferSelect): DeliveryRecord {
  return { ...row };
}

function mapMessageSettings(row: typeof hotelMessageSettings.$inferSelect): MessageSettings {
  return { ...row };
}

function mapConnection(row: typeof connections.$inferSelect): ConnectionRecord {
  return { ...row };
}

function mapNotificationPreferences(row: typeof notificationPreferences.$inferSelect): NotificationPreferences {
  return { ...row };
}

function mapPushDevice(row: typeof pushDevices.$inferSelect): PushDeviceRecord {
  return { ...row };
}

function mapRoom(row: typeof rooms.$inferSelect): RoomProfile {
  return {
    id: row.id,
    hotelId: row.hotelId,
    name: row.name,
    description: row.description,
    maxAdults: row.maxAdults,
    maxChildren: row.maxChildren,
    maxGuests: row.maxGuests,
    beds: row.beds as RoomProfile["beds"],
    amenities: row.amenities,
    photoUrls: row.photoUrls,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRatePeriod(row: typeof ratePeriods.$inferSelect, hotelId: string): RatePeriodProfile {
  return {
    id: row.id,
    hotelId,
    roomId: row.roomId,
    planCode: row.planKey,
    planName: row.planName,
    mealPlan: row.mealPlan as RatePeriodProfile["mealPlan"],
    start: row.startDate,
    endExclusive: row.endDateExclusive,
    nightlyBaseCents: row.nightlyPriceCents,
    currency: row.currency,
    includedAdults: row.includedAdults,
    includedChildren: row.includedChildren,
    extraAdultCents: row.extraAdultCents,
    extraChildCents: row.extraChildCents,
    boardAdultCents: row.boardAdultCents,
    boardChildCents: row.boardChildCents,
    maxChildAge: row.childMaxAge,
    minNights: row.minimumNights,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly db: Database) {}

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row ? mapUser(row) : null;
  }

  async createUser(input: { email: string; displayName: string | null; passwordHash: string }): Promise<UserRecord> {
    const rows = await this.db.insert(users).values(input).returning();
    const row = requireRow(rows, "create user");
    return mapUser(row);
  }

  async findOrCreateSocialUser(input: {
    provider: SocialProvider;
    subject: string;
    email: string;
    displayName: string | null;
    allowEmailLink: boolean;
  }): Promise<UserRecord> {
    return this.db.transaction(async (transaction) => {
      const subjectColumn = input.provider === "google" ? users.googleSubject : users.appleSubject;
      const [bySubject] = await transaction.select().from(users).where(eq(subjectColumn, input.subject)).limit(1);
      if (bySubject) return mapUser(bySubject);

      const [byEmail] = await transaction.select().from(users).where(eq(users.email, input.email)).limit(1);
      if (byEmail) {
        if (!input.allowEmailLink) {
          const error = new Error("The provider is not authoritative for automatic email linking.");
          error.name = "SocialIdentityConflictError";
          throw error;
        }
        const linkedSubject = input.provider === "google" ? byEmail.googleSubject : byEmail.appleSubject;
        if (linkedSubject && linkedSubject !== input.subject) {
          const error = new Error("This provider is already linked to another identity for the account.");
          error.name = "SocialIdentityConflictError";
          throw error;
        }

        const rows = await transaction
          .update(users)
          .set({
            ...(input.provider === "google"
              ? { googleSubject: input.subject }
              : { appleSubject: input.subject }),
            ...(byEmail.displayName ? {} : { displayName: input.displayName }),
            updatedAt: new Date(),
          })
          .where(and(eq(users.id, byEmail.id), isNull(subjectColumn)))
          .returning();
        const linked = rows[0];
        if (linked) return mapUser(linked);

        const [current] = await transaction.select().from(users).where(eq(users.id, byEmail.id)).limit(1);
        if (current && (input.provider === "google" ? current.googleSubject : current.appleSubject) === input.subject) {
          return mapUser(current);
        }
        const error = new Error("Social identity link changed concurrently.");
        error.name = "SocialIdentityConflictError";
        throw error;
      }

      const rows = await transaction
        .insert(users)
        .values({
          email: input.email,
          displayName: input.displayName,
          passwordHash: null,
          ...(input.provider === "google"
            ? { googleSubject: input.subject }
            : { appleSubject: input.subject }),
        })
        .returning();
      return mapUser(requireRow(rows, "create social user"));
    });
  }

  async createSession(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
    await this.db.insert(authSessions).values(input);
  }

  async findUserBySessionHash(tokenHash: string, now: Date) {
    const [row] = await this.db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(and(eq(authSessions.tokenHash, tokenHash), gt(authSessions.expiresAt, now)))
      .limit(1);

    return row ?? null;
  }

  async refreshSessionExpiry(input: {
    tokenHash: string;
    now: Date;
    renewBefore: Date;
    expiresAt: Date;
  }): Promise<void> {
    await this.db
      .update(authSessions)
      .set({ expiresAt: input.expiresAt })
      .where(and(
        eq(authSessions.tokenHash, input.tokenHash),
        gt(authSessions.expiresAt, input.now),
        lt(authSessions.expiresAt, input.renewBefore),
      ));
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.delete(authSessions).where(eq(authSessions.tokenHash, tokenHash));
  }
}

class PostgresHotelRepository implements HotelRepository {
  constructor(private readonly db: Database) {}

  async createForUser(userId: string, input: HotelCreate): Promise<HotelProfile> {
    return this.db.transaction(async (transaction) => {
      const existing = await transaction
        .select({ id: hotels.id })
        .from(hotelMembers)
        .innerJoin(hotels, eq(hotels.id, hotelMembers.hotelId))
        .where(and(eq(hotelMembers.userId, userId), isNull(hotels.deletedAt)))
        .limit(1);

      if (existing.length > 0) {
        const error = new Error("User already belongs to an active hotel.");
        error.name = "HotelMembershipConflictError";
        throw error;
      }

      const hotelRows = await transaction.insert(hotels).values(input).returning();
      const hotel = requireRow(hotelRows, "create hotel");
      await transaction.insert(hotelMembers).values({ hotelId: hotel.id, userId, role: "owner" });
      return mapHotel(hotel);
    });
  }

  async findForUser(userId: string): Promise<HotelProfile | null> {
    const [row] = await this.db
      .select({ hotel: hotels })
      .from(hotelMembers)
      .innerJoin(hotels, eq(hotels.id, hotelMembers.hotelId))
      .where(and(eq(hotelMembers.userId, userId), isNull(hotels.deletedAt)))
      .limit(1);

    return row ? mapHotel(row.hotel) : null;
  }

  async updateForUser(userId: string, input: HotelUpdate): Promise<HotelProfile | null> {
    const current = await this.findForUser(userId);
    if (!current) return null;

    const rows = await this.db
      .update(hotels)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(hotels.id, current.id), isNull(hotels.deletedAt)))
      .returning();

    const row = rows[0];
    return row ? mapHotel(row) : null;
  }

  async updateIntakeSettingsForUser(userId: string, allowedOrigins: string[]): Promise<HotelProfile | null> {
    const current = await this.findForUser(userId);
    if (!current) return null;
    const rows = await this.db
      .update(hotels)
      .set({ allowedOrigins, updatedAt: new Date() })
      .where(and(eq(hotels.id, current.id), isNull(hotels.deletedAt)))
      .returning();
    return rows[0] ? mapHotel(rows[0]) : null;
  }

  async softDeleteForUser(userId: string): Promise<boolean> {
    const current = await this.findForUser(userId);
    if (!current) return false;

    const rows = await this.db
      .update(hotels)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(hotels.id, current.id), isNull(hotels.deletedAt)))
      .returning({ id: hotels.id });

    return rows.length === 1;
  }
}

class PostgresAutomationRepository implements AutomationRepository {
  constructor(private readonly db: Database) {}

  async findPublicHotelWebsite(hotelId: string): Promise<string | null> {
    const [hotel] = await this.db.select().from(hotels).where(and(eq(hotels.id, hotelId), isNull(hotels.deletedAt))).limit(1);
    return hotel?.website || hotel?.allowedOrigins[0] || null;
  }

  async findPublicHotelByKey(publicKey: string): Promise<HotelProfile | null> {
    const [row] = await this.db
      .select()
      .from(hotels)
      .where(and(eq(hotels.publicKey, publicKey), isNull(hotels.deletedAt)))
      .limit(1);
    return row ? mapHotel(row) : null;
  }

  async listCatalogForHotel(hotelId: string) {
    const roomRows = await this.db
      .select()
      .from(rooms)
      .where(and(eq(rooms.hotelId, hotelId), eq(rooms.active, true), isNull(rooms.deletedAt)))
      .orderBy(asc(rooms.name));
    if (roomRows.length === 0) return { rooms: [], ratePeriods: [] };
    const rateRows = await this.db
      .select()
      .from(ratePeriods)
      .where(
        and(
          inArray(ratePeriods.roomId, roomRows.map(({ id }) => id)),
          eq(ratePeriods.active, true),
          isNull(ratePeriods.deletedAt),
        ),
      )
      .orderBy(asc(ratePeriods.startDate));
    return {
      rooms: roomRows.map(mapRoom),
      ratePeriods: rateRows.map((rate) => mapRatePeriod(rate, hotelId)),
    };
  }

  async findInquiryByIdempotency(hotelId: string, idempotencyKey: string): Promise<InquiryRecord | null> {
    const [row] = await this.db
      .select()
      .from(inquiries)
      .where(and(eq(inquiries.hotelId, hotelId), eq(inquiries.idempotencyKey, idempotencyKey)))
      .limit(1);
    return row ? mapInquiry(row) : null;
  }

  async createInquiryBundle(input: InquiryBundleCreate): Promise<InquiryBundle> {
    return this.db.transaction(async (transaction) => {
      const inserted = await transaction
        .insert(inquiries)
        .values({
          id: input.inquiry.id,
          hotelId: input.inquiry.hotelId,
          idempotencyKey: input.inquiry.idempotencyKey,
          guestName: input.inquiry.guestName,
          guestEmail: input.inquiry.guestEmail,
          guestPhone: input.inquiry.guestPhone,
          locale: input.inquiry.locale,
          checkIn: input.inquiry.checkIn,
          checkOut: input.inquiry.checkOut,
          occupancies: [{ adults: input.inquiry.occupancy.adults, childrenAges: input.inquiry.occupancy.childAges }],
          mealPlan: input.inquiry.mealPlan,
          source: input.inquiry.source,
          note: input.inquiry.note,
          attentionReason: input.inquiry.attentionReason,
          closedAt: input.inquiry.closedAt,
        })
        .onConflictDoNothing({ target: [inquiries.hotelId, inquiries.idempotencyKey] })
        .returning();

      if (!inserted[0]) {
        const existing = await transaction
          .select()
          .from(inquiries)
          .where(
            and(
              eq(inquiries.hotelId, input.inquiry.hotelId),
              eq(inquiries.idempotencyKey, input.inquiry.idempotencyKey),
            ),
          )
          .limit(1);
        const inquiry = mapInquiry(requireRow(existing, "find replayed inquiry"));
        const [offerRow] = inquiry.currentOfferId
          ? await transaction.select().from(offerVersions).where(eq(offerVersions.id, inquiry.currentOfferId)).limit(1)
          : [];
        const deliveryRows = await transaction
          .select()
          .from(deliveries)
          .where(eq(deliveries.inquiryId, inquiry.id));
        return {
          inquiry,
          offer: offerRow ? mapOffer(offerRow) : null,
          deliveries: deliveryRows.map(mapDelivery),
          replayed: true,
        };
      }

      let offer: OfferRecord | null = null;
      if (input.offer) {
        const offerRows = await transaction.insert(offerVersions).values(input.offer).returning();
        offer = mapOffer(requireRow(offerRows, "create offer"));
        await transaction
          .update(inquiries)
          .set({ currentOfferId: offer.id, updatedAt: new Date() })
          .where(eq(inquiries.id, input.inquiry.id));
      }
      const deliveryRows = input.deliveries?.length
        ? await transaction.insert(deliveries).values(input.deliveries).returning()
        : [];
      const [finalInquiry] = await transaction.select().from(inquiries).where(eq(inquiries.id, input.inquiry.id)).limit(1);
      return {
        inquiry: mapInquiry(requireRow(finalInquiry ? [finalInquiry] : [], "read created inquiry")),
        offer,
        deliveries: deliveryRows.map(mapDelivery),
        replayed: false,
      };
    });
  }

  async findOfferByTokenHash(tokenHash: string): Promise<OfferRecord | null> {
    const [row] = await this.db
      .select()
      .from(offerVersions)
      .where(eq(offerVersions.publicTokenHash, tokenHash))
      .limit(1);
    return row ? mapOffer(row) : null;
  }

  async replaceReservationOffers(input: ReservationOffersCreate): Promise<{ replayed: boolean } | null> {
    return this.db.transaction(async (transaction) => {
      // Editing and accepting take this same reservation lock. No new inquiry is inserted.
      const [row] = await transaction.select({ inquiry: inquiries }).from(inquiries)
        .innerJoin(hotelMembers, and(eq(hotelMembers.hotelId, inquiries.hotelId), eq(hotelMembers.userId, input.userId)))
        .where(and(eq(inquiries.id, input.inquiryId), eq(inquiries.hotelId, input.offer.hotelId)))
        .for("update", { of: inquiries });
      if (!row) return null;
      const existing = await transaction.select().from(offerVersions).where(eq(offerVersions.inquiryId, input.inquiryId));
      if (existing.some(({ id }) => id === input.offer.id)) return { replayed: true };
      if (row.inquiry.closedAt || existing.some(({ state }) => state === "accepted")) throw errors.reservationAccepted();
      if (row.inquiry.currentOfferId !== input.baseOfferId) throw errors.offersChanged();
      await transaction.update(offerVersions).set({ state: "expired" })
        .where(and(eq(offerVersions.inquiryId, input.inquiryId), eq(offerVersions.state, "active")));
      await transaction.update(deliveries).set({ state: "cancelled", updatedAt: input.now })
        .where(and(eq(deliveries.inquiryId, input.inquiryId), eq(deliveries.kind, "offer"), eq(deliveries.state, "scheduled")));
      await transaction.insert(offerVersions).values({ ...input.offer, version: Math.max(0, ...existing.map(({ version }) => version)) + 1 });
      await transaction.insert(deliveries).values(input.deliveries);
      await transaction.update(inquiries).set({ currentOfferId: input.offer.id, attentionReason: null, updatedAt: input.now })
        .where(eq(inquiries.id, input.inquiryId));
      return { replayed: false };
    });
  }

  async acceptOfferByTokenHash(tokenHash: string, now: Date, selectedOptionIndex: number): Promise<OfferRecord | null> {
    return this.db.transaction(async (transaction) => {
      const [found] = await transaction.select().from(offerVersions).where(eq(offerVersions.publicTokenHash, tokenHash)).limit(1);
      if (!found) return null;
      await transaction.select({ id: inquiries.id }).from(inquiries).where(eq(inquiries.id, found.inquiryId)).for("update");
      const [current] = await transaction.select().from(offerVersions).where(eq(offerVersions.id, found.id));
      if (!current) return null;
      if (current.state !== "active" || current.expiresAt <= now) return mapOffer(current);
      const [accepted] = await transaction.select({ id: offerVersions.id }).from(offerVersions)
        .where(and(eq(offerVersions.inquiryId, current.inquiryId), eq(offerVersions.state, "accepted"))).limit(1);
      if (accepted) {
        const [expired] = await transaction.update(offerVersions).set({ state: "expired" }).where(eq(offerVersions.id, current.id)).returning();
        return expired ? mapOffer(expired) : null;
      }
      const [result] = await transaction.update(offerVersions).set({ state: "accepted", acceptedAt: now, selectedOptionIndex })
        .where(and(eq(offerVersions.id, current.id), eq(offerVersions.state, "active"), gt(offerVersions.expiresAt, now))).returning();
      if (!result) return mapOffer(current);
      await transaction.update(offerVersions).set({ state: "expired" }).where(and(eq(offerVersions.inquiryId, current.inquiryId),
        ne(offerVersions.id, current.id), eq(offerVersions.state, "active")));
      await transaction.update(deliveries).set({ state: "cancelled", updatedAt: now }).where(and(eq(deliveries.inquiryId, current.inquiryId),
        eq(deliveries.kind, "offer"), eq(deliveries.state, "scheduled")));
      await transaction.update(inquiries).set({ currentOfferId: current.id, updatedAt: now }).where(eq(inquiries.id, current.inquiryId));
      return mapOffer(result);
    });
  }

  async markPaymentLinkSentForUser(userId: string, inquiryId: string, now: Date): Promise<InquiryRecord | null> {
    const rows = await this.db
      .select({ inquiry: inquiries })
      .from(inquiries)
      .innerJoin(hotelMembers, and(eq(hotelMembers.hotelId, inquiries.hotelId), eq(hotelMembers.userId, userId)))
      .innerJoin(offerVersions, eq(offerVersions.id, inquiries.currentOfferId))
      .where(and(eq(inquiries.id, inquiryId), isNotNull(offerVersions.acceptedAt)))
      .limit(1);
    const existing = rows[0]?.inquiry;
    if (!existing) return null;
    if (existing.closedAt) return mapInquiry(existing);
    const updated = await this.db
      .update(inquiries)
      .set({ closedAt: now, updatedAt: now })
      .where(and(eq(inquiries.id, inquiryId), eq(inquiries.hotelId, existing.hotelId), isNull(inquiries.closedAt)))
      .returning();
    return updated[0] ? mapInquiry(updated[0]) : mapInquiry({ ...existing, closedAt: now, updatedAt: now });
  }

  async dashboardPageForUser(userId: string, query: DashboardQuery): Promise<DashboardPageFacts | null> {
    // Keep the counts and page contents consistent while offers or deliveries change.
    return this.db.transaction(async (db) => {
      const [membership] = await db
        .select({ hotel: hotels })
        .from(hotelMembers)
        .innerJoin(hotels, eq(hotels.id, hotelMembers.hotelId))
        .where(and(eq(hotelMembers.userId, userId), isNull(hotels.deletedAt)))
        .limit(1);
      if (!membership) return null;
      const hotel = membership.hotel;
      const latest = db.selectDistinctOn([offerVersions.inquiryId]).from(offerVersions)
        .where(eq(offerVersions.hotelId, hotel.id))
        .orderBy(asc(offerVersions.inquiryId), desc(offerVersions.version)).as("latest_offer");
      const option = sql`${latest.snapshot}->'options'->coalesce(${latest.selectedOptionIndex}, 0)`;
      // This follows requestSummaries' precedence, including an accepted but expired offer.
      const status = sql<string>`case
        when ${inquiries.closedAt} is not null then 'completed'
        when ${latest.acceptedAt} is not null then 'payment'
        when ${inquiries.attentionReason} is not null then 'attention'
        when ${latest.state} in ('expired', 'revoked') or ${latest.expiresAt} <= now() then 'attention'
        when exists (select 1 from ${deliveries} where ${deliveries.inquiryId} = ${inquiries.id}
          and ${deliveries.offerVersionId} = ${latest.id} and ${deliveries.state} in ('provider_accepted', 'delivered')) then 'waiting'
        else 'new' end`;
      const rows = db.$with("dashboard_requests").as(db.select({
        id: inquiries.id,
        createdAt: inquiries.createdAt,
        reservationNumber: inquiries.reservationNumber,
        status: status.as("status"),
        totalCents: sql<number>`case when jsonb_typeof(${option}->'totalCents') = 'number'
          then (${option}->>'totalCents')::numeric else 0 end`.as("total_cents"),
        searchText: sql<string>`concat_ws(' ', ${inquiries.guestName}, ${inquiries.guestEmail}, ${inquiries.guestPhone},
          ${inquiries.mealPlan}, ${option}->>'roomName', ${inquiries.checkIn}, ${inquiries.checkOut},
          concat(${inquiries.checkOut} - ${inquiries.checkIn}, case when ${inquiries.checkOut} - ${inquiries.checkIn} = 1 then ' night' else ' nights' end),
          concat(coalesce((${inquiries.occupancies}->0->>'adults')::int, 1),
            case when coalesce((${inquiries.occupancies}->0->>'adults')::int, 1) = 1 then ' adult' else ' adults' end),
          concat(jsonb_array_length(coalesce(${inquiries.occupancies}->0->'childrenAges', '[]'::jsonb)),
            case when jsonb_array_length(coalesce(${inquiries.occupancies}->0->'childrenAges', '[]'::jsonb)) = 1 then ' child' else ' children' end), ${status},
          case ${status} when 'payment' then 'Payment link needed' when 'completed' then 'Waiting for client'
            when 'waiting' then 'Waiting for reply' when 'attention' then 'Review needed Not delivered' else 'New request' end)`.as("search_text"),
        failedDelivery: sql<boolean>`exists (select 1 from (
          select distinct on (${deliveries.channel}) ${deliveries.state} from ${deliveries}
          where ${deliveries.inquiryId} = ${inquiries.id}
            and ${deliveries.channel} in ('email', 'whatsapp')
            and (${latest.id} is null or ${deliveries.offerVersionId} = ${latest.id})
          order by ${deliveries.channel}, ${deliveries.createdAt} desc, ${deliveries.id} desc
        ) as latest_delivery where state = 'failed')`.as("failed_delivery"),
      }).from(inquiries).leftJoin(latest, eq(latest.inquiryId, inquiries.id))
        .where(and(eq(inquiries.hotelId, hotel.id), gte(inquiries.createdAt,
          sql<Date>`date_trunc('day', now() at time zone ${hotel.timezone}) at time zone ${hotel.timezone}`))));

      const reservationNumber = /^#?\s*(\d+)$/.exec(query.search)?.[1];
      const escapedSearch = query.search.replace(/[\\%_]/g, "\\$&");
      const matches = and(query.status === "all" ? undefined : eq(rows.status, query.status),
        !query.search ? undefined : reservationNumber !== undefined
          ? sql`${rows.reservationNumber}::text = ${reservationNumber}`
          : sql`${rows.searchText} ilike ${`%${escapedSearch}%`}`);
      const [totals] = await db.with(rows).select({
        total: sql<number>`count(*)::int`,
        new: sql<number>`count(*) filter (where ${rows.status} = 'new')::int`,
        offerSent: sql<number>`count(*) filter (where ${rows.status} = 'waiting')::int`,
        requiresConfirmation: sql<number>`count(*) filter (where ${rows.status} = 'payment')::int`,
        requiresConfirmationTotalCents: sql<number>`coalesce(sum(${rows.totalCents}) filter (where ${rows.status} = 'payment'), 0)::float8`,
        needsAttention: sql<number>`count(*) filter (where ${rows.status} = 'attention')::int`,
        failedDeliveries: sql<number>`count(*) filter (where ${rows.failedDelivery})::int`,
        filteredTotal: sql<number>`count(*) filter (where ${matches ?? sql`true`})::int`,
      }).from(rows);
      const { filteredTotal, ...counts } = totals!;
      const page = Math.min(query.page, Math.max(1, Math.ceil(filteredTotal / query.limit)));
      const order = query.sort === "asc" ? asc : desc;
      const pageRows = await db.with(rows).select({ inquiry: inquiries }).from(rows)
        .innerJoin(inquiries, eq(inquiries.id, rows.id)).where(matches)
        .orderBy(order(rows.createdAt), order(rows.id)).limit(query.limit).offset((page - 1) * query.limit);
      const ids = pageRows.map(({ inquiry }) => inquiry.id);
      const [offerRows, deliveryRows] = ids.length === 0 ? [[], []] : await Promise.all([
        db.select().from(offerVersions).where(and(eq(offerVersions.hotelId, hotel.id), inArray(offerVersions.inquiryId, ids))),
        db.select().from(deliveries).where(and(eq(deliveries.hotelId, hotel.id), inArray(deliveries.inquiryId, ids))),
      ]);
      return { hotel: mapHotel(hotel), inquiries: pageRows.map(({ inquiry }) => mapInquiry(inquiry)),
        offers: offerRows.map(mapOffer), deliveries: deliveryRows.map(mapDelivery), counts,
        pagination: { page, limit: query.limit, total: filteredTotal } };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  async dashboardFactsForUser(userId: string, inquiryIds?: string[]): Promise<DashboardFacts | null> {
    const [membership] = await this.db
      .select({ hotel: hotels })
      .from(hotelMembers)
      .innerJoin(hotels, eq(hotels.id, hotelMembers.hotelId))
      .where(and(eq(hotelMembers.userId, userId), isNull(hotels.deletedAt)))
      .limit(1);
    if (!membership) return null;
    const todayStart = sql<Date>`date_trunc('day', now() at time zone ${membership.hotel.timezone}) at time zone ${membership.hotel.timezone}`;
    const inquiryRows = await this.db
      .select()
      .from(inquiries)
      .where(and(eq(inquiries.hotelId, membership.hotel.id), inquiryIds
        ? inArray(inquiries.id, inquiryIds)
        : gte(inquiries.createdAt, todayStart)))
      .orderBy(desc(inquiries.createdAt))
      .limit(1_000);
    const foundIds = inquiryRows.map(({ id }) => id);
    const [offerRows, deliveryRows] = foundIds.length === 0
      ? [[], []]
      : await Promise.all([
          this.db.select().from(offerVersions).where(and(eq(offerVersions.hotelId, membership.hotel.id), inArray(offerVersions.inquiryId, foundIds))),
          this.db.select().from(deliveries).where(and(eq(deliveries.hotelId, membership.hotel.id), inArray(deliveries.inquiryId, foundIds))),
        ]);
    return {
      hotel: mapHotel(membership.hotel),
      inquiries: inquiryRows.map(mapInquiry),
      offers: offerRows.map(mapOffer),
      deliveries: deliveryRows.map(mapDelivery),
    };
  }
}

class PostgresInventoryRepository implements InventoryRepository {
  constructor(private readonly db: Database) {}

  async createRoomForUser(userId: string, input: RoomCreate): Promise<RoomProfile | null> {
    const hotelId = await this.findActiveHotelId(userId);
    if (!hotelId) return null;
    const rows = await this.db.insert(rooms).values({ hotelId, ...input }).returning();
    return mapRoom(requireRow(rows, "create room"));
  }

  async listRoomsForUser(userId: string): Promise<RoomProfile[]> {
    const hotelId = await this.findActiveHotelId(userId);
    if (!hotelId) return [];
    const rows = await this.db
      .select()
      .from(rooms)
      .where(and(eq(rooms.hotelId, hotelId), isNull(rooms.deletedAt)))
      .orderBy(asc(rooms.name), asc(rooms.createdAt));
    return rows.map(mapRoom);
  }

  async findRoomForUser(userId: string, roomId: string): Promise<RoomProfile | null> {
    const hotelId = await this.findActiveHotelId(userId);
    if (!hotelId) return null;
    const [row] = await this.db
      .select()
      .from(rooms)
      .where(and(eq(rooms.id, roomId), eq(rooms.hotelId, hotelId), isNull(rooms.deletedAt)))
      .limit(1);
    return row ? mapRoom(row) : null;
  }

  async updateRoomForUser(userId: string, roomId: string, input: RoomUpdate): Promise<RoomProfile | null> {
    const current = await this.findRoomForUser(userId, roomId);
    if (!current) return null;
    const rows = await this.db
      .update(rooms)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(rooms.id, roomId), eq(rooms.hotelId, current.hotelId), isNull(rooms.deletedAt)))
      .returning();
    const row = rows[0];
    return row ? mapRoom(row) : null;
  }

  async softDeleteRoomForUser(userId: string, roomId: string): Promise<boolean> {
    const current = await this.findRoomForUser(userId, roomId);
    if (!current) return false;
    const rows = await this.db
      .update(rooms)
      .set({ active: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(rooms.id, roomId), eq(rooms.hotelId, current.hotelId), isNull(rooms.deletedAt)))
      .returning({ id: rooms.id });
    return rows.length === 1;
  }

  async createRatePeriodForUser(
    userId: string,
    roomId: string,
    input: RatePeriodCreate,
  ): Promise<RatePeriodProfile | null> {
    const room = await this.findRoomForUser(userId, roomId);
    if (!room) return null;
    try {
      const rows = await this.db
        .insert(ratePeriods)
        .values({
          roomId,
          planKey: input.planCode,
          planName: input.planName,
          mealPlan: input.mealPlan,
          startDate: input.start,
          endDateExclusive: input.endExclusive,
          nightlyPriceCents: input.nightlyBaseCents,
          currency: input.currency,
          includedAdults: input.includedAdults,
          includedChildren: input.includedChildren,
          extraAdultCents: input.extraAdultCents,
          extraChildCents: input.extraChildCents,
          boardAdultCents: input.boardAdultCents,
          boardChildCents: input.boardChildCents,
          childMaxAge: input.maxChildAge,
          minimumNights: input.minNights,
          active: input.active,
        })
        .returning();
      return mapRatePeriod(requireRow(rows, "create rate period"), room.hotelId);
    } catch (error) {
      throwRateOverlap(error);
    }
  }

  async listRatePeriodsForUser(userId: string, roomId: string): Promise<RatePeriodProfile[] | null> {
    const room = await this.findRoomForUser(userId, roomId);
    if (!room) return null;
    const rows = await this.db
      .select()
      .from(ratePeriods)
      .where(and(eq(ratePeriods.roomId, roomId), isNull(ratePeriods.deletedAt)))
      .orderBy(asc(ratePeriods.planKey), asc(ratePeriods.startDate));
    return rows.map((row) => mapRatePeriod(row, room.hotelId));
  }

  async findRatePeriodForUser(
    userId: string,
    roomId: string,
    ratePeriodId: string,
  ): Promise<RatePeriodProfile | null> {
    const room = await this.findRoomForUser(userId, roomId);
    if (!room) return null;
    const [row] = await this.db
      .select()
      .from(ratePeriods)
      .where(
        and(
          eq(ratePeriods.id, ratePeriodId),
          eq(ratePeriods.roomId, roomId),
          isNull(ratePeriods.deletedAt),
        ),
      )
      .limit(1);
    return row ? mapRatePeriod(row, room.hotelId) : null;
  }

  async updateRatePeriodForUser(
    userId: string,
    roomId: string,
    ratePeriodId: string,
    input: RatePeriodUpdate,
  ): Promise<RatePeriodProfile | null> {
    const current = await this.findRatePeriodForUser(userId, roomId, ratePeriodId);
    if (!current) return null;
    const values = {
      ...(input.planCode === undefined ? {} : { planKey: input.planCode }),
      ...(input.planName === undefined ? {} : { planName: input.planName }),
      ...(input.mealPlan === undefined ? {} : { mealPlan: input.mealPlan }),
      ...(input.start === undefined ? {} : { startDate: input.start }),
      ...(input.endExclusive === undefined ? {} : { endDateExclusive: input.endExclusive }),
      ...(input.nightlyBaseCents === undefined ? {} : { nightlyPriceCents: input.nightlyBaseCents }),
      ...(input.currency === undefined ? {} : { currency: input.currency }),
      ...(input.includedAdults === undefined ? {} : { includedAdults: input.includedAdults }),
      ...(input.includedChildren === undefined ? {} : { includedChildren: input.includedChildren }),
      ...(input.extraAdultCents === undefined ? {} : { extraAdultCents: input.extraAdultCents }),
      ...(input.extraChildCents === undefined ? {} : { extraChildCents: input.extraChildCents }),
      ...(input.boardAdultCents === undefined ? {} : { boardAdultCents: input.boardAdultCents }),
      ...(input.boardChildCents === undefined ? {} : { boardChildCents: input.boardChildCents }),
      ...(input.maxChildAge === undefined ? {} : { childMaxAge: input.maxChildAge }),
      ...(input.minNights === undefined ? {} : { minimumNights: input.minNights }),
      ...(input.active === undefined ? {} : { active: input.active }),
      updatedAt: new Date(),
    };
    try {
      const rows = await this.db
        .update(ratePeriods)
        .set(values)
        .where(
          and(
            eq(ratePeriods.id, ratePeriodId),
            eq(ratePeriods.roomId, roomId),
            isNull(ratePeriods.deletedAt),
          ),
        )
        .returning();
      const row = rows[0];
      return row ? mapRatePeriod(row, current.hotelId) : null;
    } catch (error) {
      throwRateOverlap(error);
    }
  }

  async softDeleteRatePeriodForUser(userId: string, roomId: string, ratePeriodId: string): Promise<boolean> {
    const current = await this.findRatePeriodForUser(userId, roomId, ratePeriodId);
    if (!current) return false;
    const rows = await this.db
      .update(ratePeriods)
      .set({ active: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(ratePeriods.id, ratePeriodId),
          eq(ratePeriods.roomId, roomId),
          isNull(ratePeriods.deletedAt),
        ),
      )
      .returning({ id: ratePeriods.id });
    return rows.length === 1;
  }

  async findRateOverlapsForUser(input: {
    userId: string;
    roomId: string;
    planCode: string;
    mealPlan: MealPlan;
    start: string;
    endExclusive: string;
    excludeRatePeriodId?: string;
  }) {
    const room = await this.findRoomForUser(input.userId, input.roomId);
    if (!room) return null;
    const conditions = [
      eq(ratePeriods.roomId, input.roomId),
      eq(ratePeriods.planKey, input.planCode),
      eq(ratePeriods.mealPlan, input.mealPlan),
      eq(ratePeriods.active, true),
      isNull(ratePeriods.deletedAt),
      lt(ratePeriods.startDate, input.endExclusive),
      gt(ratePeriods.endDateExclusive, input.start),
    ];
    if (input.excludeRatePeriodId) conditions.push(ne(ratePeriods.id, input.excludeRatePeriodId));
    return this.db
      .select({ id: ratePeriods.id, start: ratePeriods.startDate, endExclusive: ratePeriods.endDateExclusive })
      .from(ratePeriods)
      .where(and(...conditions))
      .orderBy(asc(ratePeriods.startDate));
  }

  private async findActiveHotelId(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: hotels.id })
      .from(hotelMembers)
      .innerJoin(hotels, eq(hotels.id, hotelMembers.hotelId))
      .where(and(eq(hotelMembers.userId, userId), isNull(hotels.deletedAt)))
      .limit(1);
    return row?.id ?? null;
  }
}

class PostgresChannelRepository implements ChannelRepository {
  constructor(private readonly db: Database) {}

  async findMessageSettingsForUser(userId: string): Promise<MessageSettings | null> {
    const hotelId = await this.findActiveHotelId(userId);
    if (!hotelId) return null;
    const [row] = await this.db
      .select()
      .from(hotelMessageSettings)
      .where(eq(hotelMessageSettings.hotelId, hotelId))
      .limit(1);
    return row ? mapMessageSettings(row) : null;
  }

  async upsertMessageSettingsForUser(
    userId: string,
    input: MessageSettingsUpdate,
  ): Promise<MessageSettings | null> {
    const hotelId = await this.findActiveHotelId(userId);
    if (!hotelId) return null;
    const rows = await this.db
      .insert(hotelMessageSettings)
      .values({ hotelId, ...input })
      .onConflictDoUpdate({
        target: hotelMessageSettings.hotelId,
        set: { ...input, updatedAt: new Date() },
      })
      .returning();
    return rows[0] ? mapMessageSettings(rows[0]) : null;
  }

  async listConnectionsForUser(userId: string): Promise<ConnectionRecord[] | null> {
    const hotelId = await this.findActiveHotelId(userId);
    if (!hotelId) return null;
    const rows = await this.db
      .select()
      .from(connections)
      .where(eq(connections.hotelId, hotelId))
      .orderBy(asc(connections.kind));
    return rows.map(mapConnection);
  }

  async findConnectionForUser(
    userId: string,
    kind: ConnectionRecord["kind"],
  ): Promise<ConnectionRecord | null> {
    const hotelId = await this.findActiveHotelId(userId);
    if (!hotelId) return null;
    const [row] = await this.db
      .select()
      .from(connections)
      .where(and(eq(connections.hotelId, hotelId), eq(connections.kind, kind)))
      .limit(1);
    return row ? mapConnection(row) : null;
  }

  async configureMailForUser(input: { userId: string; kind: "smtp"; encryptedCredentials: string; metadata: Record<string, unknown> }) {
    const hotelId = await this.findActiveHotelId(input.userId);
    if (!hotelId) return null;
    const rows = await this.db.insert(connections).values({ hotelId, kind: input.kind, state: "connected", encryptedCredentials: input.encryptedCredentials, metadata: input.metadata, lastCheckedAt: new Date(), lastErrorCode: null }).onConflictDoUpdate({ target: [connections.hotelId, connections.kind], set: { state: "connected", encryptedCredentials: input.encryptedCredentials, metadata: input.metadata, lastCheckedAt: new Date(), lastErrorCode: null, updatedAt: new Date() } }).returning();
    return rows[0] ? mapConnection(rows[0]) : null;
  }

  async beginMailOAuthForUser(input: { userId: string; kind: "google" | "microsoft"; nonceHash: string; expiresAt: Date; metadata: Record<string, unknown> }) {
    const hotelId = await this.findActiveHotelId(input.userId); if (!hotelId) return null;
    const metadata = { ...input.metadata, oauthNonceHash: input.nonceHash, oauthExpiresAt: input.expiresAt.toISOString() };
    const rows = await this.db.insert(connections).values({ hotelId, kind: input.kind, state: "connecting", metadata }).onConflictDoUpdate({ target: [connections.hotelId, connections.kind], set: { state: "connecting", metadata, lastCheckedAt: null, lastErrorCode: null, updatedAt: new Date() } }).returning();
    return rows[0] ? { hotelId, connection: mapConnection(rows[0]) } : null;
  }

  async consumeMailOAuthState(input: { hotelId: string; kind: "google" | "microsoft"; nonceHash: string; now: Date }) {
    const [current] = await this.db.select().from(connections).where(and(eq(connections.hotelId, input.hotelId), eq(connections.kind, input.kind))).limit(1);
    if (!current || current.metadata.oauthNonceHash !== input.nonceHash || typeof current.metadata.oauthExpiresAt !== "string" || new Date(current.metadata.oauthExpiresAt) <= input.now) return null;
    const rows = await this.db.update(connections).set({ state: "connecting", metadata: { ...current.metadata, oauthNonceHash: null, oauthExpiresAt: null, authorizationReceivedAt: input.now.toISOString() }, lastCheckedAt: input.now, lastErrorCode: "TOKEN_EXCHANGE_PENDING", updatedAt: input.now }).where(and(eq(connections.id, current.id), sql`${connections.metadata}->>'oauthNonceHash' = ${input.nonceHash}`)).returning();
    return rows[0] ? mapConnection(rows[0]) : null;
  }

  async configureWahaForUser(input: {
    userId: string;
    encryptedCredentials: string;
    metadata: Record<string, unknown>;
  }): Promise<ConnectionRecord | null> {
    const hotelId = await this.findActiveHotelId(input.userId);
    if (!hotelId) return null;
    const rows = await this.db
      .insert(connections)
      .values({
        hotelId,
        kind: "waha",
        state: "disconnected",
        encryptedCredentials: input.encryptedCredentials,
        metadata: input.metadata,
        lastCheckedAt: null,
        lastErrorCode: null,
      })
      .onConflictDoUpdate({
        target: [connections.hotelId, connections.kind],
        set: {
          state: "disconnected",
          encryptedCredentials: input.encryptedCredentials,
          metadata: input.metadata,
          lastCheckedAt: null,
          lastErrorCode: null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return rows[0] ? mapConnection(rows[0]) : null;
  }

  async beginGoogleOAuthForUser(input: {
    userId: string;
    nonceHash: string;
    expiresAt: Date;
  }): Promise<{ hotelId: string; connection: ConnectionRecord } | null> {
    const hotelId = await this.findActiveHotelId(input.userId);
    if (!hotelId) return null;
    const metadata = {
      oauthNonceHash: input.nonceHash,
      oauthExpiresAt: input.expiresAt.toISOString(),
    };
    const rows = await this.db
      .insert(connections)
      .values({ hotelId, kind: "google", state: "connecting", metadata })
      .onConflictDoUpdate({
        target: [connections.hotelId, connections.kind],
        set: {
          state: "connecting",
          metadata,
          lastCheckedAt: null,
          lastErrorCode: null,
          updatedAt: new Date(),
        },
      })
      .returning();
    const row = rows[0];
    return row ? { hotelId, connection: mapConnection(row) } : null;
  }

  async consumeGoogleOAuthState(input: {
    hotelId: string;
    nonceHash: string;
    now: Date;
  }): Promise<ConnectionRecord | null> {
    const [current] = await this.db
      .select()
      .from(connections)
      .where(and(eq(connections.hotelId, input.hotelId), eq(connections.kind, "google")))
      .limit(1);
    if (!current) return null;
    const expiresAt = current.metadata.oauthExpiresAt;
    if (
      current.metadata.oauthNonceHash !== input.nonceHash ||
      typeof expiresAt !== "string" ||
      new Date(expiresAt) <= input.now
    ) {
      return null;
    }
    const {
      oauthNonceHash: _oauthNonceHash,
      oauthExpiresAt: _oauthExpiresAt,
      ...metadata
    } = current.metadata;
    const rows = await this.db
      .update(connections)
      .set({
        state: "connecting",
        metadata: { ...metadata, authorizationReceivedAt: input.now.toISOString() },
        lastCheckedAt: input.now,
        lastErrorCode: "TOKEN_EXCHANGE_PENDING",
        updatedAt: input.now,
      })
      .where(
        and(
          eq(connections.id, current.id),
          sql`${connections.metadata}->>'oauthNonceHash' = ${input.nonceHash}`,
        ),
      )
      .returning();
    return rows[0] ? mapConnection(rows[0]) : null;
  }

  async updateConnectionForHotel(input: {
    hotelId: string;
    kind: ConnectionKind;
    state: ConnectionRecord["state"];
    encryptedCredentials?: string | null;
    metadata?: Record<string, unknown>;
    lastCheckedAt: Date;
    lastErrorCode: string | null;
  }): Promise<ConnectionRecord | null> {
    const rows = await this.db
      .update(connections)
      .set({
        state: input.state,
        ...(input.encryptedCredentials === undefined ? {} : { encryptedCredentials: input.encryptedCredentials }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        lastCheckedAt: input.lastCheckedAt,
        lastErrorCode: input.lastErrorCode,
        updatedAt: input.lastCheckedAt,
      })
      .where(and(eq(connections.hotelId, input.hotelId), eq(connections.kind, input.kind)))
      .returning();
    return rows[0] ? mapConnection(rows[0]) : null;
  }

  async createTestDeliveryForUser(
    userId: string,
    input: Omit<DeliveryRecord, "hotelId" | "createdAt" | "updatedAt">,
  ): Promise<DeliveryRecord | null> {
    const hotelId = await this.findActiveHotelId(userId);
    if (!hotelId) return null;
    const rows = await this.db.insert(deliveries).values({ hotelId, ...input }).returning();
    return rows[0] ? mapDelivery(rows[0]) : null;
  }

  private async findActiveHotelId(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: hotels.id })
      .from(hotelMembers)
      .innerJoin(hotels, eq(hotels.id, hotelMembers.hotelId))
      .where(and(eq(hotelMembers.userId, userId), isNull(hotels.deletedAt)))
      .limit(1);
    return row?.id ?? null;
  }
}

class PostgresPlatformAdminRepository implements PlatformAdminRepository {
  constructor(private readonly db: Database) {}

  async listWhatsAppSupportRecords(): Promise<WhatsAppSupportRecord[]> {
    const [hotelRows, connectionRows, successRows, failureRows] = await Promise.all([
      this.db.select().from(hotels).where(isNull(hotels.deletedAt)).orderBy(asc(hotels.name)),
      this.db.select().from(connections).where(eq(connections.kind, "waha")),
      this.db
        .selectDistinctOn([deliveries.hotelId], {
          hotelId: deliveries.hotelId,
          processedAt: deliveries.processedAt,
          updatedAt: deliveries.updatedAt,
        })
        .from(deliveries)
        .where(and(eq(deliveries.channel, "whatsapp"), inArray(deliveries.state, ["provider_accepted", "delivered"])))
        .orderBy(deliveries.hotelId, desc(deliveries.updatedAt)),
      this.db
        .selectDistinctOn([deliveries.hotelId], {
          hotelId: deliveries.hotelId,
          processedAt: deliveries.processedAt,
          updatedAt: deliveries.updatedAt,
          lastErrorCode: deliveries.lastErrorCode,
        })
        .from(deliveries)
        .where(and(eq(deliveries.channel, "whatsapp"), inArray(deliveries.state, ["failed", "unknown"])))
        .orderBy(deliveries.hotelId, desc(deliveries.updatedAt)),
    ]);
    const connectionByHotel = new Map(connectionRows.map((row) => [row.hotelId, mapConnection(row)]));
    const successByHotel = new Map(successRows.map((row) => [row.hotelId, row.processedAt ?? row.updatedAt]));
    const failureByHotel = new Map(failureRows.map((row) => [row.hotelId, row]));
    return hotelRows.map((row) => {
      const failure = failureByHotel.get(row.id);
      return {
        hotel: {
          id: row.id,
          name: row.name,
          city: row.city,
          email: row.email,
          phone: row.phone,
        },
        connection: connectionByHotel.get(row.id) ?? null,
        lastSuccessfulMessageAt: successByHotel.get(row.id) ?? null,
        lastFailedMessageAt: failure ? (failure.processedAt ?? failure.updatedAt) : null,
        lastDeliveryErrorCode: failure?.lastErrorCode ?? null,
      };
    });
  }

  async findWhatsAppSupportRecord(hotelId: string): Promise<WhatsAppSupportRecord | null> {
    return (await this.listWhatsAppSupportRecords()).find((record) => record.hotel.id === hotelId) ?? null;
  }

  async updateWhatsAppConnection(input: {
    hotelId: string;
    state: ConnectionRecord["state"];
    metadata: Record<string, unknown>;
    lastCheckedAt: Date;
    lastErrorCode: string | null;
  }): Promise<ConnectionRecord | null> {
    const [row] = await this.db
      .update(connections)
      .set({
        state: input.state,
        metadata: input.metadata,
        lastCheckedAt: input.lastCheckedAt,
        lastErrorCode: input.lastErrorCode,
        updatedAt: input.lastCheckedAt,
      })
      .where(and(eq(connections.hotelId, input.hotelId), eq(connections.kind, "waha")))
      .returning();
    return row ? mapConnection(row) : null;
  }
}

class PostgresDeliveryWorkerRepository implements DeliveryWorkerRepository {
  constructor(private readonly db: Database) {}

  async claimNextOfferDelivery(now: Date): Promise<ClaimedOfferDelivery | null> {
    return this.db.transaction(async (transaction) => {
      const [candidate] = await transaction
        .select()
        .from(deliveries)
        .where(
          and(
            eq(deliveries.kind, "offer"),
            eq(deliveries.state, "scheduled"),
            lte(deliveries.nextAttemptAt, now),
            inArray(deliveries.channel, ["email", "whatsapp"]),
          ),
        )
        .orderBy(asc(deliveries.nextAttemptAt), asc(deliveries.createdAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!candidate) return null;

      const [claimed] = await transaction
        .update(deliveries)
        .set({ state: "processing", updatedAt: now })
        .where(and(eq(deliveries.id, candidate.id), eq(deliveries.state, "scheduled")))
        .returning();
      if (!claimed) return null;

      const [offer, hotel, settings, connection] = await Promise.all([
        claimed.offerVersionId
          ? transaction
              .select()
              .from(offerVersions)
              .where(eq(offerVersions.id, claimed.offerVersionId))
              .limit(1)
              .then((rows) => rows[0] ?? null)
          : Promise.resolve(null),
        transaction
          .select()
          .from(hotels)
          .where(and(eq(hotels.id, claimed.hotelId), isNull(hotels.deletedAt)))
          .limit(1)
          .then((rows) => rows[0] ?? null),
        transaction
          .select()
          .from(hotelMessageSettings)
          .where(eq(hotelMessageSettings.hotelId, claimed.hotelId))
          .limit(1)
          .then((rows) => rows[0] ?? null),
        transaction
          .select()
          .from(connections)
          .where(
            and(
              eq(connections.hotelId, claimed.hotelId),
              claimed.channel === "email" ? inArray(connections.kind, ["google", "microsoft", "smtp"]) : eq(connections.kind, "waha"),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null),
      ]);

      return {
        delivery: mapDelivery(claimed),
        offer: offer ? mapOffer(offer) : null,
        hotel: hotel ? mapHotel(hotel) : null,
        settings: settings ? mapMessageSettings(settings) : null,
        connection: connection ? mapConnection(connection) : null,
      };
    });
  }

  async settleClaimedDelivery(input: {
    deliveryId: string;
    state: "scheduled" | "provider_accepted" | "failed" | "unknown";
    attemptCount: number;
    nextAttemptAt: Date;
    providerMessageId: string | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    processedAt: Date | null;
    now: Date;
  }): Promise<boolean> {
    const rows = await this.db
      .update(deliveries)
      .set({
        state: input.state,
        attemptCount: input.attemptCount,
        nextAttemptAt: input.nextAttemptAt,
        providerMessageId: input.providerMessageId,
        lastErrorCode: input.lastErrorCode,
        lastErrorMessage: input.lastErrorMessage,
        processedAt: input.processedAt,
        updatedAt: input.now,
      })
      .where(and(eq(deliveries.id, input.deliveryId), eq(deliveries.state, "processing")))
      .returning({ id: deliveries.id });
    return rows.length === 1;
  }
}

class PostgresNotificationRepository implements NotificationRepository {
  constructor(private readonly db: Database) {}

  async findPreferencesForUser(userId: string) {
    const [user] = await this.db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return null;
    const [preferenceRows, deviceRows] = await Promise.all([
      this.db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).limit(1),
      this.db.select().from(pushDevices).where(and(eq(pushDevices.userId, userId), eq(pushDevices.active, true))).orderBy(desc(pushDevices.lastRegisteredAt)),
    ]);
    return {
      user,
      preferences: preferenceRows[0] ? mapNotificationPreferences(preferenceRows[0]) : null,
      devices: deviceRows.map(mapPushDevice),
    };
  }

  async upsertPreferencesForUser(
    userId: string,
    input: Pick<NotificationPreferences, "pushAllRequests" | "emailIncomingRequests" | "emailAddress">,
  ) {
    const rows = await this.db
      .insert(notificationPreferences)
      .values({ userId, ...input })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: { ...input, updatedAt: new Date() },
      })
      .returning();
    return rows[0] ? mapNotificationPreferences(rows[0]) : null;
  }

  async registerPushDeviceForUser(
    userId: string,
    input: { expoPushToken: string; platform: string; deviceName: string | null },
  ) {
    const now = new Date();
    const rows = await this.db
      .insert(pushDevices)
      .values({ userId, ...input, active: true, lastRegisteredAt: now })
      .onConflictDoUpdate({
        target: pushDevices.expoPushToken,
        set: { userId, platform: input.platform, deviceName: input.deviceName, active: true, lastRegisteredAt: now, updatedAt: now },
      })
      .returning();
    return rows[0] ? mapPushDevice(rows[0]) : null;
  }

  async deactivatePushDeviceForUser(userId: string, expoPushToken: string): Promise<boolean> {
    const rows = await this.db
      .update(pushDevices)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(pushDevices.userId, userId), eq(pushDevices.expoPushToken, expoPushToken)))
      .returning({ id: pushDevices.id });
    return rows.length === 1;
  }

  async deactivatePushDeviceByToken(expoPushToken: string): Promise<void> {
    await this.db
      .update(pushDevices)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(pushDevices.expoPushToken, expoPushToken));
  }

  async listTargetsForHotel(hotelId: string) {
    const memberRows = await this.db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(hotelMembers)
      .innerJoin(users, eq(users.id, hotelMembers.userId))
      .where(eq(hotelMembers.hotelId, hotelId));
    if (memberRows.length === 0) return [];
    const userIds = memberRows.map(({ id }) => id);
    const [preferenceRows, deviceRows] = await Promise.all([
      this.db.select().from(notificationPreferences).where(inArray(notificationPreferences.userId, userIds)),
      this.db.select().from(pushDevices).where(and(inArray(pushDevices.userId, userIds), eq(pushDevices.active, true))),
    ]);
    return memberRows.map((user) => ({
      user,
      preferences: preferenceRows.find(({ userId }) => userId === user.id)
        ? mapNotificationPreferences(preferenceRows.find(({ userId }) => userId === user.id)!)
        : null,
      devices: deviceRows.filter(({ userId }) => userId === user.id).map(mapPushDevice),
    }));
  }
}

function throwRateOverlap(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23P01") {
    const conflict = new Error("Rate period overlap.");
    conflict.name = "RateOverlapConflictError";
    throw conflict;
  }
  throw error;
}

class PostgresSystemRepository implements SystemRepository {
  constructor(private readonly db: Database) {}

  async checkDatabase(): Promise<boolean> {
    try {
      await this.db.execute(sql`select 1`);
      return true;
    } catch {
      return false;
    }
  }
}

export function createPostgresRepositories(db: Database): Repositories {
  return {
    auth: new PostgresAuthRepository(db),
    hotels: new PostgresHotelRepository(db),
    inventory: new PostgresInventoryRepository(db),
    automation: new PostgresAutomationRepository(db),
    channels: new PostgresChannelRepository(db),
    platformAdmin: new PostgresPlatformAdminRepository(db),
    deliveryWorker: new PostgresDeliveryWorkerRepository(db),
    notifications: new PostgresNotificationRepository(db),
    system: new PostgresSystemRepository(db),
  };
}
