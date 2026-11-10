import { randomUUID } from "node:crypto";
import type { DashboardQuery, OfferSettings } from "@hotel/contracts";
import { AUTOMATIC_SENDING_TIMEOUT_MS } from "@hotel/contracts";

import type {
  AuthRepository,
  AutomationRepository,
  ChannelRepository,
  ClaimedOfferDelivery,
  ConnectionKind,
  ConnectionRecord,
  DashboardFacts,
  DashboardPageFacts,
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
  NotificationPreferences,
  NotificationRepository,
  OfferRecord,
  ReservationOffersCreate,
  PlatformAdminRepository,
  PushDeviceRecord,
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
  WhatsAppSupportRecord,
} from "../../src/repositories/types.js";
import { errors } from "../../src/lib/errors.js";
import { acceptedStay } from "../../src/lib/accepted-stay.js";

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

  async updateUserLanguage(userId: string, uiLanguage: "en" | "it"): Promise<void> {
    const user = this.users.get(userId);
    if (user) user.uiLanguage = uiLanguage;
  }

  async createSession(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
    this.sessions.set(input.tokenHash, { userId: input.userId, expiresAt: input.expiresAt });
  }

  async findUserBySessionHash(tokenHash: string, now: Date) {
    const session = this.sessions.get(tokenHash);
    if (!session || session.expiresAt <= now) return null;
    const user = this.users.get(session.userId);
    return user ? { id: user.id, email: user.email, displayName: user.displayName, ...(user.uiLanguage ? { uiLanguage: user.uiLanguage } : {}) } : null;
  }

  async refreshSessionExpiry(input: {
    tokenHash: string;
    now: Date;
    renewBefore: Date;
    expiresAt: Date;
  }): Promise<void> {
    const session = this.sessions.get(input.tokenHash);
    if (session && session.expiresAt > input.now && session.expiresAt < input.renewBefore) {
      this.sessions.set(input.tokenHash, { ...session, expiresAt: input.expiresAt });
    }
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
  readonly offerSettings = new Map<string, OfferSettings>();
  private nextReservationNumber = 1n;
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

  async findOfferSettingsForHotel(hotelId: string): Promise<OfferSettings | null> {
    return this.offerSettings.get(hotelId) ?? null;
  }

  async saveOfferSettingsForUser(userId: string, settings: OfferSettings): Promise<OfferSettings | null> {
    const hotel = await this.hotels.findForUser(userId);
    if (!hotel) return null;
    this.offerSettings.set(hotel.id, settings);
    return settings;
  }

  async findPublicHotelWebsite(hotelId: string): Promise<string | null> {
    const hotel = this.hotels.hotels.get(hotelId);
    return hotel?.website || hotel?.allowedOrigins[0] || null;
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
      reservationNumber: (this.nextReservationNumber++).toString(),
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

  async replaceReservationOffers(input: ReservationOffersCreate): Promise<{ replayed: boolean } | null> {
    const hotel = await this.hotels.findForUser(input.userId);
    const inquiry = this.inquiries.get(input.inquiryId);
    if (!hotel || !inquiry || hotel.id !== inquiry.hotelId || input.offer.hotelId !== hotel.id) return null;
    const existing = [...this.offers.values()].filter(({ inquiryId }) => inquiryId === inquiry.id);
    if (existing.some(({ id }) => id === input.offer.id)) return { replayed: true };
    if (inquiry.closedAt || existing.some(({ state }) => state === "accepted")) throw errors.reservationAccepted();
    if (inquiry.currentOfferId !== input.baseOfferId) throw errors.offersChanged();
    for (const offer of existing) if (offer.state === "active") this.offers.set(offer.id, { ...offer, state: "expired" });
    for (const delivery of this.deliveries.values()) {
      if (delivery.inquiryId === inquiry.id && delivery.kind === "offer" && delivery.state === "scheduled") {
        this.deliveries.set(delivery.id, { ...delivery, state: "cancelled", updatedAt: input.now });
      }
    }
    this.offers.set(input.offer.id, { ...input.offer, version: Math.max(0, ...existing.map(({ version }) => version)) + 1, createdAt: input.now });
    for (const delivery of input.deliveries) this.deliveries.set(delivery.id, { ...delivery, createdAt: input.now, updatedAt: input.now });
    this.inquiries.set(inquiry.id, { ...inquiry, currentOfferId: input.offer.id, attentionReason: null, updatedAt: input.now });
    return { replayed: false };
  }

  async acceptOfferByTokenHash(tokenHash: string, now: Date, selectedOptionIndex: number): Promise<OfferRecord | null> {
    const found = await this.findOfferByTokenHash(tokenHash);
    const offer = found ? this.offers.get(found.id) ?? null : null;
    if (!offer || offer.state === "accepted" || offer.state !== "active" || offer.expiresAt <= now) return offer;
    const previous = [...this.offers.values()].find((candidate) => candidate.inquiryId === offer.inquiryId && candidate.state === "accepted");
    if (previous) {
      const expired = { ...offer, state: "expired" as const };
      this.offers.set(offer.id, expired);
      return expired;
    }
    const accepted = { ...offer, state: "accepted" as const, acceptedAt: now, selectedOptionIndex };
    this.offers.set(offer.id, accepted);
    for (const sibling of this.offers.values()) {
      if (sibling.inquiryId === offer.inquiryId && sibling.id !== offer.id && sibling.state === "active") {
        this.offers.set(sibling.id, { ...sibling, state: "expired" });
      }
    }
    for (const delivery of this.deliveries.values()) {
      if (delivery.inquiryId === offer.inquiryId && delivery.kind === "offer" && delivery.state === "scheduled") {
        this.deliveries.set(delivery.id, { ...delivery, state: "cancelled", updatedAt: now });
      }
    }
    const inquiry = this.inquiries.get(offer.inquiryId);
    if (inquiry) this.inquiries.set(inquiry.id, { ...inquiry, ...acceptedStay(offer.snapshot, selectedOptionIndex), currentOfferId: offer.id, updatedAt: now });
    return accepted;
  }

  async markPaymentLinkSentForUser(userId: string, inquiryId: string, now: Date): Promise<InquiryRecord | null> {
    const hotel = await this.hotels.findForUser(userId);
    const inquiry = this.inquiries.get(inquiryId);
    if (!hotel || !inquiry || inquiry.hotelId !== hotel.id || !inquiry.currentOfferId) return null;
    const offer = this.offers.get(inquiry.currentOfferId);
    if (!offer?.acceptedAt) return null;
    if (inquiry.closedAt) return inquiry;
    const updated = { ...inquiry, closedAt: now, updatedAt: now };
    this.inquiries.set(inquiry.id, updated);
    return updated;
  }

  async dashboardPageForUser(userId: string, query: DashboardQuery): Promise<DashboardPageFacts | null> {
    const facts = await this.dashboardFactsForUser(userId);
    if (!facts) return null;
    const now = new Date();
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: facts.hotel.timezone });
    const items = facts.inquiries.filter((inquiry) => day.format(inquiry.createdAt) === day.format(now)).map((inquiry) => {
      const latest = facts.offers.filter((offer) => offer.inquiryId === inquiry.id).sort((a, b) => b.version - a.version)[0];
      const currentDeliveries = facts.deliveries.filter((delivery) => delivery.inquiryId === inquiry.id && (!latest || delivery.offerVersionId === latest.id));
      const status = inquiry.closedAt ? "completed" : latest?.acceptedAt ? "payment" : inquiry.attentionReason ? "attention"
        : latest && (latest.state === "expired" || latest.state === "revoked" || latest.expiresAt <= now) ? "attention"
        : latest && currentDeliveries.some(({ state }) => state === "provider_accepted" || state === "delivered") ? "waiting"
        : (latest?.createdAt ?? inquiry.createdAt).getTime() + AUTOMATIC_SENDING_TIMEOUT_MS <= now.getTime() ? "attention" : "new";
      const processingDeadlineAt = new Date((latest?.createdAt ?? inquiry.createdAt).getTime() + AUTOMATIC_SENDING_TIMEOUT_MS);
      const options = latest?.snapshot.options;
      const option = Array.isArray(options) ? options[latest?.selectedOptionIndex ?? 0] as Record<string, unknown> | undefined : undefined;
      return { inquiry, status, option, processingDeadlineAt };
    });
    const reservationNumber = /^#?\s*(\d+)$/.exec(query.search)?.[1];
    const labels: Record<string, string> = { new: "New", waiting: "Waiting for reply", payment: "Payment link needed", completed: "Waiting for client", attention: "Not delivered" };
    const filtered = items.filter(({ inquiry, status, option }) => (query.status === "all" || query.status === status) && (!query.search ||
      (reservationNumber !== undefined ? inquiry.reservationNumber === reservationNumber :
        [inquiry.guestName, inquiry.guestEmail, inquiry.guestPhone, inquiry.mealPlan, option?.roomName, inquiry.checkIn, inquiry.checkOut, labels[status]]
          .some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(query.search.toLocaleLowerCase())))));
    const direction = query.sort === "asc" ? 1 : -1;
    filtered.sort((a, b) => direction * (a.inquiry.createdAt.getTime() - b.inquiry.createdAt.getTime() || a.inquiry.id.localeCompare(b.inquiry.id)));
    const page = Math.min(query.page, Math.max(1, Math.ceil(filtered.length / query.limit)));
    return { ...facts, inquiries: filtered.slice((page - 1) * query.limit, page * query.limit).map(({ inquiry }) => inquiry),
      counts: { total: items.length, new: items.filter(({ status }) => status === "new").length,
        offerSent: items.filter(({ status }) => status === "waiting").length,
        requiresConfirmation: items.filter(({ status }) => status === "payment").length,
        requiresConfirmationTotalCents: items.filter(({ status }) => status === "payment").reduce((total, { option }) => total + (typeof option?.totalCents === "number" ? option.totalCents : 0), 0),
        needsAttention: items.filter(({ status }) => status === "attention").length },
      pagination: { page, limit: query.limit, total: filtered.length },
      evaluatedAt: now, nextProcessingDeadlineAt: items.filter(({ status }) => status === "new").map(({ processingDeadlineAt }) => processingDeadlineAt)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null };
  }

  async dashboardFactsForUser(userId: string, inquiryIds?: string[]): Promise<DashboardFacts | null> {
    const hotel = await this.hotels.findForUser(userId);
    if (!hotel) return null;
    return {
      hotel,
      inquiries: [...this.inquiries.values()].filter(({ hotelId, id }) => hotelId === hotel.id && (!inquiryIds || inquiryIds.includes(id))),
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
    mealPlan: "BB" | "HB" | "FB";
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
          rate.mealPlan === input.mealPlan &&
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

class MemoryNotificationRepository implements NotificationRepository {
  readonly preferences = new Map<string, NotificationPreferences>();
  readonly devices = new Map<string, PushDeviceRecord>();

  constructor(
    private readonly auth: MemoryAuthRepository,
    private readonly hotels: MemoryHotelRepository,
  ) {}

  async findPreferencesForUser(userId: string) {
    const user = this.auth.users.get(userId);
    if (!user) return null;
    return {
      user: { id: user.id, email: user.email, displayName: user.displayName, ...(user.uiLanguage ? { uiLanguage: user.uiLanguage } : {}) },
      preferences: this.preferences.get(userId) ?? null,
      devices: [...this.devices.values()].filter((device) => device.userId === userId && device.active),
    };
  }

  async upsertPreferencesForUser(
    userId: string,
    input: Pick<NotificationPreferences, "pushAllRequests" | "emailIncomingRequests" | "emailAddress">,
  ) {
    if (!this.auth.users.has(userId)) return null;
    const now = new Date();
    const current = this.preferences.get(userId);
    const preference: NotificationPreferences = {
      userId,
      ...input,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.preferences.set(userId, preference);
    return preference;
  }

  async registerPushDeviceForUser(
    userId: string,
    input: { expoPushToken: string; platform: string; deviceName: string | null },
  ) {
    if (!this.auth.users.has(userId)) return null;
    const now = new Date();
    const existing = [...this.devices.values()].find(({ expoPushToken }) => expoPushToken === input.expoPushToken);
    const device: PushDeviceRecord = {
      id: existing?.id ?? randomUUID(),
      userId,
      ...input,
      active: true,
      lastRegisteredAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.devices.set(device.id, device);
    return device;
  }

  async deactivatePushDeviceForUser(userId: string, expoPushToken: string) {
    const device = [...this.devices.values()].find((item) => item.userId === userId && item.expoPushToken === expoPushToken);
    if (!device) return false;
    this.devices.set(device.id, { ...device, active: false, updatedAt: new Date() });
    return true;
  }

  async deactivatePushDeviceByToken(expoPushToken: string) {
    const device = [...this.devices.values()].find((item) => item.expoPushToken === expoPushToken);
    if (device) this.devices.set(device.id, { ...device, active: false, updatedAt: new Date() });
  }

  async listTargetsForHotel(hotelId: string) {
    const userIds = [...this.hotels.memberships.entries()]
      .filter(([, memberHotelId]) => memberHotelId === hotelId)
      .map(([userId]) => userId);
    return userIds.flatMap((userId) => {
      const user = this.auth.users.get(userId);
      if (!user) return [];
      return [{
        user: { id: user.id, email: user.email, displayName: user.displayName, ...(user.uiLanguage ? { uiLanguage: user.uiLanguage } : {}) },
        preferences: this.preferences.get(userId) ?? null,
        devices: [...this.devices.values()].filter((device) => device.userId === userId && device.active),
      }];
    });
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

  async configureMailForUser(input: { userId: string; kind: "smtp"; encryptedCredentials: string; metadata: Record<string, unknown> }) {
    const hotelId = this.hotels.memberships.get(input.userId);
    if (!hotelId) return null;
    return this.saveConnection(hotelId, input.kind, { state: "connected", encryptedCredentials: input.encryptedCredentials, metadata: input.metadata, lastCheckedAt: new Date(), lastErrorCode: null });
  }

  async beginMailOAuthForUser(input: { userId: string; kind: "google" | "microsoft"; nonceHash: string; expiresAt: Date; metadata: Record<string, unknown> }) {
    const hotelId = this.hotels.memberships.get(input.userId); if (!hotelId) return null;
    const connection = this.saveConnection(hotelId, input.kind, { state: "connecting", encryptedCredentials: this.connections.get(`${hotelId}:${input.kind}`)?.encryptedCredentials ?? null, metadata: { ...input.metadata, oauthNonceHash: input.nonceHash, oauthExpiresAt: input.expiresAt.toISOString() }, lastCheckedAt: null, lastErrorCode: null });
    return { hotelId, connection };
  }

  async consumeMailOAuthState(input: { hotelId: string; kind: "google" | "microsoft"; nonceHash: string; now: Date }) {
    const current = this.connections.get(`${input.hotelId}:${input.kind}`); const expires = current?.metadata.oauthExpiresAt;
    if (!current || current.metadata.oauthNonceHash !== input.nonceHash || typeof expires !== "string" || new Date(expires) <= input.now) return null;
    return this.saveConnection(input.hotelId, input.kind, { state: "connecting", encryptedCredentials: current.encryptedCredentials, metadata: { ...current.metadata, oauthNonceHash: null, oauthExpiresAt: null }, lastCheckedAt: input.now, lastErrorCode: "TOKEN_EXCHANGE_PENDING" });
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
      metadata: {
        ...current.metadata,
        oauthNonceHash: undefined,
        oauthExpiresAt: undefined,
        authorizationReceivedAt: input.now.toISOString(),
      },
      lastCheckedAt: input.now,
      lastErrorCode: "TOKEN_EXCHANGE_PENDING",
    });
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
    const current = this.connections.get(`${input.hotelId}:${input.kind}`);
    if (!current) return null;
    return this.saveConnection(input.hotelId, input.kind, {
      state: input.state,
      encryptedCredentials: input.encryptedCredentials === undefined
        ? current.encryptedCredentials
        : input.encryptedCredentials,
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

class MemoryPlatformAdminRepository implements PlatformAdminRepository {
  constructor(
    private readonly hotels: MemoryHotelRepository,
    private readonly automation: MemoryAutomationRepository,
    private readonly channels: MemoryChannelRepository,
  ) {}

  async listWhatsAppSupportRecords(): Promise<WhatsAppSupportRecord[]> {
    return [...this.hotels.hotels.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((hotel) => {
        const deliveries = [...this.automation.deliveries.values()]
          .filter((delivery) => delivery.hotelId === hotel.id && delivery.channel === "whatsapp")
          .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
        const success = deliveries.find(({ state }) => state === "provider_accepted" || state === "delivered");
        const failure = deliveries.find(({ state }) => state === "failed" || state === "unknown");
        return {
          hotel: { id: hotel.id, name: hotel.name, city: hotel.city, email: hotel.email, phone: hotel.phone },
          connection: this.channels.connections.get(`${hotel.id}:waha`) ?? null,
          lastSuccessfulMessageAt: success ? (success.processedAt ?? success.updatedAt) : null,
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
    const current = this.channels.connections.get(`${input.hotelId}:waha`);
    if (!current) return null;
    const updated = {
      ...current,
      state: input.state,
      metadata: input.metadata,
      lastCheckedAt: input.lastCheckedAt,
      lastErrorCode: input.lastErrorCode,
      updatedAt: input.lastCheckedAt,
    };
    this.channels.connections.set(`${input.hotelId}:waha`, updated);
    return updated;
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
  platformAdmin: MemoryPlatformAdminRepository;
  deliveryWorker: MemoryDeliveryWorkerRepository;
  notifications: MemoryNotificationRepository;
  system: MemorySystemRepository;
};

export function createMemoryRepositories(): MemoryRepositories {
  const auth = new MemoryAuthRepository();
  const hotels = new MemoryHotelRepository();
  const inventory = new MemoryInventoryRepository(hotels);
  const automation = new MemoryAutomationRepository(hotels, inventory);
  const channels = new MemoryChannelRepository(hotels, automation);
  return {
    auth,
    hotels,
    inventory,
    automation,
    channels,
    platformAdmin: new MemoryPlatformAdminRepository(hotels, automation, channels),
    deliveryWorker: new MemoryDeliveryWorkerRepository(hotels, automation, channels),
    notifications: new MemoryNotificationRepository(auth, hotels),
    system: new MemorySystemRepository(),
  };
}
