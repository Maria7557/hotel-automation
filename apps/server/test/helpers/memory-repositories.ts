import { randomUUID } from "node:crypto";

import type {
  AuthRepository,
  AutomationRepository,
  ChannelRepository,
  ClaimedOfferDelivery,
  ConnectionKind,
  ConnectionRecord,
  DashboardFacts,
  DeliveryRecord,
  DeliveryWorkerRepository,
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
  RatePeriodCreate,
  RatePeriodProfile,
  RatePeriodUpdate,
  Repositories,
  RoomCreate,
  RoomProfile,
  RoomUpdate,
  SocialProvider,
  SystemRepository,
  UserRecord,
} from "../../src/repositories/types.js";

class MemoryAuthRepository implements AuthRepository {
  readonly users = new Map<string, UserRecord>();
  readonly sessions = new Map<string, { userId: string; expiresAt: Date }>();

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    return [...this.users.values()].find((user) => user.email === email) ?? null;
  }

  async createUser(input: { email: string; displayName: string | null; passwordHash: string }): Promise<UserRecord> {
    if (await this.findUserByEmail(input.email)) {
      const error = Object.assign(new Error("duplicate email"), { code: "23505" });
      throw error;
    }
    const user: UserRecord = {
      id: randomUUID(),
      ...input,
      googleSubject: null,
      appleSubject: null,
    };
    this.users.set(user.id, user);
    return user;
  }

  async findOrCreateSocialUser(input: {
    provider: SocialProvider;
    subject: string;
    email: string;
    displayName: string | null;
    allowEmailLink: boolean;
  }): Promise<UserRecord> {
    const subjectKey = input.provider === "google" ? "googleSubject" : "appleSubject";
    const bySubject = [...this.users.values()].find((user) => user[subjectKey] === input.subject);
    if (bySubject) return bySubject;

    const byEmail = await this.findUserByEmail(input.email);
    if (byEmail) {
      if (!input.allowEmailLink) {
        const error = new Error("non-authoritative email link");
        error.name = "SocialIdentityConflictError";
        throw error;
      }
      if (byEmail[subjectKey] && byEmail[subjectKey] !== input.subject) {
        const error = new Error("social identity conflict");
        error.name = "SocialIdentityConflictError";
        throw error;
      }
      byEmail[subjectKey] = input.subject;
      byEmail.displayName ||= input.displayName;
      return byEmail;
    }

    const user: UserRecord = {
      id: randomUUID(),
      email: input.email,
      displayName: input.displayName,
      passwordHash: null,
      googleSubject: input.provider === "google" ? input.subject : null,
      appleSubject: input.provider === "apple" ? input.subject : null,
    };
    this.users.set(user.id, user);
    return user;
  }

  async createSession(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
    this.sessions.set(input.tokenHash, { userId: input.userId, expiresAt: input.expiresAt });
  }

  async findUserBySessionHash(tokenHash: string, now: Date) {
    const session = this.sessions.get(tokenHash);
    if (!session || session.expiresAt <= now) return null;
    const user = this.users.get(session.userId);
    return user ? { id: user.id, email: user.email, displayName: user.displayName } : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }
}

class MemoryHotelRepository implements HotelRepository {
  readonly hotels = new Map<string, HotelProfile>();
  readonly memberships = new Map<string, string>();

  async createForUser(userId: string, input: HotelCreate): Promise<HotelProfile> {
    if (this.memberships.has(userId)) {
      const error = new Error("membership conflict");
      error.name = "HotelMembershipConflictError";
      throw error;
    }
    const now = new Date();
    const hotel = {
      id: randomUUID(),
      publicKey: randomUUID(),
      allowedOrigins: [],
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.hotels.set(hotel.id, hotel);
    this.memberships.set(userId, hotel.id);
    return hotel;
  }

  async findForUser(userId: string): Promise<HotelProfile | null> {
    const hotelId = this.memberships.get(userId);
    return hotelId ? (this.hotels.get(hotelId) ?? null) : null;
  }

  async updateForUser(userId: string, input: HotelUpdate): Promise<HotelProfile | null> {
    const current = await this.findForUser(userId);
    if (!current) return null;
    const updated = { ...current, ...input, updatedAt: new Date() };
    this.hotels.set(current.id, updated);
    return updated;
  }

  async updateIntakeSettingsForUser(userId: string, allowedOrigins: string[]): Promise<HotelProfile | null> {
    const current = await this.findForUser(userId);
    if (!current) return null;
    const updated = { ...current, allowedOrigins, updatedAt: new Date() };
    this.hotels.set(current.id, updated);
    return updated;
  }

  async softDeleteForUser(userId: string): Promise<boolean> {
    const hotelId = this.memberships.get(userId);
    if (!hotelId) return false;
    this.memberships.delete(userId);
    this.hotels.delete(hotelId);
    return true;
  }
}

class MemoryAutomationRepository implements AutomationRepository {
  readonly inquiries = new Map<string, InquiryRecord>();
  readonly offers = new Map<string, OfferRecord>();
  readonly deliveries = new Map<string, DeliveryRecord>();

  constructor(
    private readonly hotels: MemoryHotelRepository,
    private readonly inventory: MemoryInventoryRepository,
  ) {}

  async findPublicHotelByKey(publicKey: string): Promise<HotelProfile | null> {
    return [...this.hotels.hotels.values()].find((hotel) => hotel.publicKey === publicKey) ?? null;
  }

  async listCatalogForHotel(hotelId: string) {
    const rooms = [...this.inventory.rooms.values()].filter((room) => room.hotelId === hotelId && room.active);
    const roomIds = new Set(rooms.map(({ id }) => id));
    return {
      rooms,
      ratePeriods: [...this.inventory.rates.values()].filter((rate) => roomIds.has(rate.roomId) && rate.active),
    };
  }

  async findInquiryByIdempotency(hotelId: string, idempotencyKey: string): Promise<InquiryRecord | null> {
    return [...this.inquiries.values()].find(
      (inquiry) => inquiry.hotelId === hotelId && inquiry.idempotencyKey === idempotencyKey,
    ) ?? null;
  }

  async createInquiryBundle(input: InquiryBundleCreate): Promise<InquiryBundle> {
    const existing = await this.findInquiryByIdempotency(input.inquiry.hotelId, input.inquiry.idempotencyKey);
    if (existing) {
      return {
        inquiry: existing,
        offer: existing.currentOfferId ? (this.offers.get(existing.currentOfferId) ?? null) : null,
        deliveries: [...this.deliveries.values()].filter(({ inquiryId }) => inquiryId === existing.id),
        replayed: true,
      };
    }
    const now = new Date();
    const inquiry: InquiryRecord = {
      ...input.inquiry,
      currentOfferId: input.offer?.id ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.inquiries.set(inquiry.id, inquiry);
    let offer: OfferRecord | null = null;
    if (input.offer) {
      offer = { ...input.offer, createdAt: now };
      this.offers.set(offer.id, offer);
    }
    const createdDeliveries = (input.deliveries ?? []).map((delivery) => ({
      ...delivery,
      createdAt: now,
      updatedAt: now,
    }));
    for (const delivery of createdDeliveries) this.deliveries.set(delivery.id, delivery);
    return { inquiry, offer, deliveries: createdDeliveries, replayed: false };
  }

  async findOfferByTokenHash(tokenHash: string): Promise<OfferRecord | null> {
    return [...this.offers.values()].find(({ publicTokenHash }) => publicTokenHash === tokenHash) ?? null;
  }

  async acceptOfferByTokenHash(tokenHash: string, now: Date, selectedOptionIndex: number): Promise<OfferRecord | null> {
    const offer = await this.findOfferByTokenHash(tokenHash);
    if (!offer || offer.state === "accepted" || offer.state !== "active" || offer.expiresAt <= now) return offer;
    const accepted = { ...offer, state: "accepted" as const, acceptedAt: now, selectedOptionIndex };
    this.offers.set(offer.id, accepted);
    return accepted;
  }

  async dashboardFactsForUser(userId: string): Promise<DashboardFacts | null> {
    const hotel = await this.hotels.findForUser(userId);
    if (!hotel) return null;
    return {
      hotel,
      inquiries: [...this.inquiries.values()].filter(({ hotelId }) => hotelId === hotel.id),
      offers: [...this.offers.values()].filter(({ hotelId }) => hotelId === hotel.id),
      deliveries: [...this.deliveries.values()].filter(({ hotelId }) => hotelId === hotel.id),
    };
  }
}

class MemoryInventoryRepository implements InventoryRepository {
  readonly rooms = new Map<string, RoomProfile>();
  readonly rates = new Map<string, RatePeriodProfile>();

  constructor(private readonly hotels: MemoryHotelRepository) {}

  async createRoomForUser(userId: string, input: RoomCreate): Promise<RoomProfile | null> {
    const hotelId = this.hotels.memberships.get(userId);
    if (!hotelId) return null;
    const now = new Date();
    const room = { id: randomUUID(), hotelId, ...input, createdAt: now, updatedAt: now };
    this.rooms.set(room.id, room);
    return room;
  }

  async listRoomsForUser(userId: string): Promise<RoomProfile[]> {
    const hotelId = this.hotels.memberships.get(userId);
    return hotelId ? [...this.rooms.values()].filter((room) => room.hotelId === hotelId) : [];
  }

  async findRoomForUser(userId: string, roomId: string): Promise<RoomProfile | null> {
    const hotelId = this.hotels.memberships.get(userId);
    const room = this.rooms.get(roomId);
    return hotelId && room?.hotelId === hotelId ? room : null;
  }

  async updateRoomForUser(userId: string, roomId: string, input: RoomUpdate): Promise<RoomProfile | null> {
    const current = await this.findRoomForUser(userId, roomId);
    if (!current) return null;
    const room = { ...current, ...input, updatedAt: new Date() };
    this.rooms.set(roomId, room);
    return room;
  }

  async softDeleteRoomForUser(userId: string, roomId: string): Promise<boolean> {
    if (!(await this.findRoomForUser(userId, roomId))) return false;
    this.rooms.delete(roomId);
    for (const [id, rate] of this.rates) if (rate.roomId === roomId) this.rates.delete(id);
    return true;
  }

  async createRatePeriodForUser(
    userId: string,
    roomId: string,
    input: RatePeriodCreate,
  ): Promise<RatePeriodProfile | null> {
    const room = await this.findRoomForUser(userId, roomId);
    if (!room) return null;
    const now = new Date();
    const rate = {
      id: randomUUID(),
      hotelId: room.hotelId,
      roomId,
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.rates.set(rate.id, rate);
    return rate;
  }

  async listRatePeriodsForUser(userId: string, roomId: string): Promise<RatePeriodProfile[] | null> {
    if (!(await this.findRoomForUser(userId, roomId))) return null;
    return [...this.rates.values()]
      .filter((rate) => rate.roomId === roomId)
      .sort((left, right) => left.start.localeCompare(right.start));
  }

  async findRatePeriodForUser(
    userId: string,
    roomId: string,
    ratePeriodId: string,
  ): Promise<RatePeriodProfile | null> {
    if (!(await this.findRoomForUser(userId, roomId))) return null;
    const rate = this.rates.get(ratePeriodId);
    return rate?.roomId === roomId ? rate : null;
  }

  async updateRatePeriodForUser(
    userId: string,
    roomId: string,
    ratePeriodId: string,
    input: RatePeriodUpdate,
  ): Promise<RatePeriodProfile | null> {
    const current = await this.findRatePeriodForUser(userId, roomId, ratePeriodId);
    if (!current) return null;
    const rate = { ...current, ...input, updatedAt: new Date() };
    this.rates.set(ratePeriodId, rate);
    return rate;
  }

  async softDeleteRatePeriodForUser(userId: string, roomId: string, ratePeriodId: string): Promise<boolean> {
    if (!(await this.findRatePeriodForUser(userId, roomId, ratePeriodId))) return false;
    this.rates.delete(ratePeriodId);
    return true;
  }

  async findRateOverlapsForUser(input: {
    userId: string;
    roomId: string;
    planCode: string;
    start: string;
    endExclusive: string;
    excludeRatePeriodId?: string;
  }) {
    if (!(await this.findRoomForUser(input.userId, input.roomId))) return null;
    return [...this.rates.values()]
      .filter(
        (rate) =>
          rate.roomId === input.roomId &&
          rate.id !== input.excludeRatePeriodId &&
          rate.active &&
          rate.planCode === input.planCode &&
          rate.start < input.endExclusive &&
          input.start < rate.endExclusive,
      )
      .map(({ id, start, endExclusive }) => ({ id, start, endExclusive }));
  }
}

class MemorySystemRepository implements SystemRepository {
  databaseUp = true;

  async checkDatabase(): Promise<boolean> {
    return this.databaseUp;
  }
}

class MemoryChannelRepository implements ChannelRepository {
  readonly settings = new Map<string, MessageSettings>();
  readonly connections = new Map<string, ConnectionRecord>();

  constructor(
    private readonly hotels: MemoryHotelRepository,
    private readonly automation: MemoryAutomationRepository,
  ) {}

  async findMessageSettingsForUser(userId: string): Promise<MessageSettings | null> {
    const hotelId = this.hotels.memberships.get(userId);
    return hotelId ? (this.settings.get(hotelId) ?? null) : null;
  }

  async upsertMessageSettingsForUser(
    userId: string,
    input: MessageSettingsUpdate,
  ): Promise<MessageSettings | null> {
    const hotelId = this.hotels.memberships.get(userId);
    if (!hotelId) return null;
    const current = this.settings.get(hotelId);
    const now = new Date();
    const settings = {
      hotelId,
      ...input,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.settings.set(hotelId, settings);
    return settings;
  }

  async listConnectionsForUser(userId: string): Promise<ConnectionRecord[] | null> {
    const hotelId = this.hotels.memberships.get(userId);
    if (!hotelId) return null;
    return [...this.connections.values()].filter((connection) => connection.hotelId === hotelId);
  }

  async findConnectionForUser(
    userId: string,
    kind: ConnectionKind,
  ): Promise<ConnectionRecord | null> {
    const hotelId = this.hotels.memberships.get(userId);
    return hotelId ? (this.connections.get(`${hotelId}:${kind}`) ?? null) : null;
  }

  async configureWahaForUser(input: {
    userId: string;
    encryptedCredentials: string;
    metadata: Record<string, unknown>;
  }): Promise<ConnectionRecord | null> {
    const hotelId = this.hotels.memberships.get(input.userId);
    if (!hotelId) return null;
    return this.saveConnection(hotelId, "waha", {
      state: "disconnected",
      encryptedCredentials: input.encryptedCredentials,
      metadata: input.metadata,
      lastCheckedAt: null,
      lastErrorCode: null,
    });
  }

  async beginGoogleOAuthForUser(input: {
    userId: string;
    nonceHash: string;
    expiresAt: Date;
  }): Promise<{ hotelId: string; connection: ConnectionRecord } | null> {
    const hotelId = this.hotels.memberships.get(input.userId);
    if (!hotelId) return null;
    const connection = this.saveConnection(hotelId, "google", {
      state: "connecting",
      encryptedCredentials: this.connections.get(`${hotelId}:google`)?.encryptedCredentials ?? null,
      metadata: {
        oauthNonceHash: input.nonceHash,
        oauthExpiresAt: input.expiresAt.toISOString(),
      },
      lastCheckedAt: null,
      lastErrorCode: null,
    });
    return { hotelId, connection };
  }

  async consumeGoogleOAuthState(input: {
    hotelId: string;
    nonceHash: string;
    now: Date;
  }): Promise<ConnectionRecord | null> {
    const current = this.connections.get(`${input.hotelId}:google`);
    const expiresAt = current?.metadata.oauthExpiresAt;
    if (
      !current ||
      current.metadata.oauthNonceHash !== input.nonceHash ||
      typeof expiresAt !== "string" ||
      new Date(expiresAt) <= input.now
    ) {
      return null;
    }
    return this.saveConnection(input.hotelId, "google", {
      state: "connecting",
      encryptedCredentials: current.encryptedCredentials,
      metadata: { authorizationReceivedAt: input.now.toISOString() },
      lastCheckedAt: input.now,
      lastErrorCode: "TOKEN_EXCHANGE_PENDING",
    });
  }

  async updateConnectionForHotel(input: {
    hotelId: string;
    kind: ConnectionKind;
    state: ConnectionRecord["state"];
    encryptedCredentials?: string;
    metadata?: Record<string, unknown>;
    lastCheckedAt: Date;
    lastErrorCode: string | null;
  }): Promise<ConnectionRecord | null> {
    const current = this.connections.get(`${input.hotelId}:${input.kind}`);
    if (!current) return null;
    return this.saveConnection(input.hotelId, input.kind, {
      state: input.state,
      encryptedCredentials: input.encryptedCredentials ?? current.encryptedCredentials,
      metadata: input.metadata ?? current.metadata,
      lastCheckedAt: input.lastCheckedAt,
      lastErrorCode: input.lastErrorCode,
    });
  }

  async createTestDeliveryForUser(
    userId: string,
    input: Omit<DeliveryRecord, "hotelId" | "createdAt" | "updatedAt">,
  ): Promise<DeliveryRecord | null> {
    const hotelId = this.hotels.memberships.get(userId);
    if (!hotelId) return null;
    const now = new Date();
    const delivery = { hotelId, ...input, createdAt: now, updatedAt: now };
    this.automation.deliveries.set(delivery.id, delivery);
    return delivery;
  }

  private saveConnection(
    hotelId: string,
    kind: ConnectionKind,
    input: Pick<
      ConnectionRecord,
      "state" | "encryptedCredentials" | "metadata" | "lastCheckedAt" | "lastErrorCode"
    >,
  ): ConnectionRecord {
    const key = `${hotelId}:${kind}`;
    const current = this.connections.get(key);
    const now = new Date();
    const connection = {
      id: current?.id ?? randomUUID(),
      hotelId,
      kind,
      ...input,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.connections.set(key, connection);
    return connection;
  }
}

class MemoryDeliveryWorkerRepository implements DeliveryWorkerRepository {
  constructor(
    private readonly hotels: MemoryHotelRepository,
    private readonly automation: MemoryAutomationRepository,
    private readonly channels: MemoryChannelRepository,
  ) {}

  async claimNextOfferDelivery(now: Date): Promise<ClaimedOfferDelivery | null> {
    const candidate = [...this.automation.deliveries.values()]
      .filter(
        (delivery) =>
          delivery.kind === "offer" &&
          delivery.state === "scheduled" &&
          delivery.nextAttemptAt <= now &&
          (delivery.channel === "email" || delivery.channel === "whatsapp"),
      )
      .sort(
        (left, right) =>
          left.nextAttemptAt.getTime() - right.nextAttemptAt.getTime() ||
          left.createdAt.getTime() - right.createdAt.getTime(),
      )[0];
    if (!candidate) return null;
    const claimed = { ...candidate, state: "processing" as const, updatedAt: now };
    this.automation.deliveries.set(claimed.id, claimed);
    const hotel = this.hotels.hotels.get(claimed.hotelId) ?? null;
    const connectionKind = claimed.channel === "email" ? "google" : "waha";
    return {
      delivery: claimed,
      offer: claimed.offerVersionId
        ? (this.automation.offers.get(claimed.offerVersionId) ?? null)
        : null,
      hotel,
      settings: this.channels.settings.get(claimed.hotelId) ?? null,
      connection: this.channels.connections.get(`${claimed.hotelId}:${connectionKind}`) ?? null,
    };
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
    const current = this.automation.deliveries.get(input.deliveryId);
    if (!current || current.state !== "processing") return false;
    this.automation.deliveries.set(input.deliveryId, {
      ...current,
      state: input.state,
      attemptCount: input.attemptCount,
      nextAttemptAt: input.nextAttemptAt,
      providerMessageId: input.providerMessageId,
      lastErrorCode: input.lastErrorCode,
      lastErrorMessage: input.lastErrorMessage,
      processedAt: input.processedAt,
      updatedAt: input.now,
    });
    return true;
  }
}

export type MemoryRepositories = Repositories & {
  auth: MemoryAuthRepository;
  hotels: MemoryHotelRepository;
  inventory: MemoryInventoryRepository;
  automation: MemoryAutomationRepository;
  channels: MemoryChannelRepository;
  deliveryWorker: MemoryDeliveryWorkerRepository;
  system: MemorySystemRepository;
};

export function createMemoryRepositories(): MemoryRepositories {
  const hotels = new MemoryHotelRepository();
  const inventory = new MemoryInventoryRepository(hotels);
  const automation = new MemoryAutomationRepository(hotels, inventory);
  const channels = new MemoryChannelRepository(hotels, automation);
  return {
    auth: new MemoryAuthRepository(),
    hotels,
    inventory,
    automation,
    channels,
    deliveryWorker: new MemoryDeliveryWorkerRepository(hotels, automation, channels),
    system: new MemorySystemRepository(),
  };
}
