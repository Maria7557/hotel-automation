import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";

import type { Database } from "../db/client.js";
import {
  authSessions,
  connections,
  deliveries,
  hotelMessageSettings,
  hotelMembers,
  hotels,
  inquiries,
  offerVersions,
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
  OfferRecord,
  PlatformAdminRepository,
  RatePeriodCreate,
  RatePeriodProfile,
  RatePeriodUpdate,
  Repositories,
  RoomCreate,
  RoomProfile,
  RoomUpdate,
  SystemRepository,
  SocialProvider,
  UserRecord,
  WhatsAppSupportRecord,
} from "./types.js";

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
    hotelId: row.hotelId,
    idempotencyKey: row.idempotencyKey,
    guestName: row.guestName,
    guestEmail: row.guestEmail,
    guestPhone: row.guestPhone,
    locale: row.locale,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    occupancy: { adults: occupancy.adults, childAges: occupancy.childrenAges },
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
    breakfastAdultCents: row.breakfastAdultCents,
    breakfastChildCents: row.breakfastChildCents,
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

  async acceptOfferByTokenHash(tokenHash: string, now: Date, selectedOptionIndex: number): Promise<OfferRecord | null> {
    const current = await this.findOfferByTokenHash(tokenHash);
    if (!current || current.state === "accepted" || current.state !== "active" || current.expiresAt <= now) return current;
    const rows = await this.db
      .update(offerVersions)
      .set({ state: "accepted", acceptedAt: now, selectedOptionIndex })
      .where(and(eq(offerVersions.publicTokenHash, tokenHash), eq(offerVersions.state, "active"), gt(offerVersions.expiresAt, now)))
      .returning();
    return rows[0] ? mapOffer(rows[0]) : this.findOfferByTokenHash(tokenHash);
  }

  async dashboardFactsForUser(userId: string): Promise<DashboardFacts | null> {
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
      .where(and(eq(inquiries.hotelId, membership.hotel.id), gte(inquiries.createdAt, todayStart)))
      .orderBy(desc(inquiries.createdAt))
      .limit(1_000);
    const inquiryIds = inquiryRows.map(({ id }) => id);
    const [offerRows, deliveryRows] = inquiryIds.length === 0
      ? [[], []]
      : await Promise.all([
          this.db.select().from(offerVersions).where(and(eq(offerVersions.hotelId, membership.hotel.id), inArray(offerVersions.inquiryId, inquiryIds))),
          this.db.select().from(deliveries).where(and(eq(deliveries.hotelId, membership.hotel.id), inArray(deliveries.inquiryId, inquiryIds))),
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
          breakfastAdultCents: input.breakfastAdultCents,
          breakfastChildCents: input.breakfastChildCents,
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
      ...(input.breakfastAdultCents === undefined ? {} : { breakfastAdultCents: input.breakfastAdultCents }),
      ...(input.breakfastChildCents === undefined ? {} : { breakfastChildCents: input.breakfastChildCents }),
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
    start: string;
    endExclusive: string;
    excludeRatePeriodId?: string;
  }) {
    const room = await this.findRoomForUser(input.userId, input.roomId);
    if (!room) return null;
    const conditions = [
      eq(ratePeriods.roomId, input.roomId),
      eq(ratePeriods.planKey, input.planCode),
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
    system: new PostgresSystemRepository(db),
  };
}
