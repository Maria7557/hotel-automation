import type { DashboardPagination, DashboardQuery, MealPlan, OfferSettings } from "@hotel/contracts";

export type UserRecord = {
  uiLanguage?: "en" | "it" | null;
  id: string;
  email: string;
  displayName: string | null;
  passwordHash: string | null;
  googleSubject: string | null;
  appleSubject: string | null;
};

export type PublicUser = Pick<UserRecord, "id" | "email" | "displayName" | "uiLanguage">;

export type SocialProvider = "google" | "apple";

export type HotelProfile = {
  id: string;
  publicKey: string;
  allowedOrigins: string[];
  name: string;
  city: string;
  countryCode: string;
  locale: string;
  description: string | null;
  currency: string;
  timezone: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  logoUrl: string | null;
  photoUrls: string[];
  termsText: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type HotelCreate = Omit<
  HotelProfile,
  "id" | "publicKey" | "allowedOrigins" | "createdAt" | "updatedAt"
>;
export type HotelUpdate = Partial<HotelCreate>;

export type Bed = {
  type: "single" | "double" | "queen" | "king" | "sofa_bed" | "bunk" | "crib";
  count: number;
};

export type RoomProfile = {
  id: string;
  hotelId: string;
  name: string;
  description: string | null;
  maxAdults: number;
  maxChildren: number;
  maxGuests: number;
  beds: Bed[];
  amenities: string[];
  photoUrls: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type RoomCreate = Omit<RoomProfile, "id" | "hotelId" | "createdAt" | "updatedAt">;
export type RoomUpdate = Partial<RoomCreate>;

export type RatePeriodProfile = {
  id: string;
  hotelId: string;
  roomId: string;
  planCode: string;
  planName: string;
  mealPlan: MealPlan;
  start: string;
  endExclusive: string;
  nightlyBaseCents: number;
  currency: string;
  includedAdults: number;
  includedChildren: number;
  extraAdultCents: number;
  extraChildCents: number;
  boardAdultCents: number;
  boardChildCents: number;
  maxChildAge: number;
  minNights: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type RatePeriodCreate = Omit<
  RatePeriodProfile,
  "id" | "hotelId" | "roomId" | "createdAt" | "updatedAt"
>;
export type RatePeriodUpdate = Partial<RatePeriodCreate>;

export type RateOverlap = Pick<RatePeriodProfile, "id" | "start" | "endExclusive">;

export interface AuthRepository {
  updateUserLanguage(userId: string, uiLanguage: "en" | "it"): Promise<void>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  createUser(input: { email: string; displayName: string | null; passwordHash: string }): Promise<UserRecord>;
  findOrCreateSocialUser(input: {
    provider: SocialProvider;
    subject: string;
    email: string;
    displayName: string | null;
    allowEmailLink: boolean;
  }): Promise<UserRecord>;
  createSession(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  findUserBySessionHash(tokenHash: string, now: Date): Promise<PublicUser | null>;
  refreshSessionExpiry(input: {
    tokenHash: string;
    now: Date;
    renewBefore: Date;
    expiresAt: Date;
  }): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
}

export interface HotelRepository {
  createForUser(userId: string, input: HotelCreate): Promise<HotelProfile>;
  findForUser(userId: string): Promise<HotelProfile | null>;
  updateForUser(userId: string, input: HotelUpdate): Promise<HotelProfile | null>;
  updateIntakeSettingsForUser(userId: string, allowedOrigins: string[]): Promise<HotelProfile | null>;
  softDeleteForUser(userId: string): Promise<boolean>;
}

export type InquiryAttentionReason =
  | "no_matching_room"
  | "meal_plan_unavailable"
  | "missing_rate"
  | "ambiguous_rate"
  | "invalid_guest_data"
  | "manual_review";

export type InquiryRecord = {
  id: string;
  reservationNumber: string;
  hotelId: string;
  idempotencyKey: string;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  locale: string;
  checkIn: string;
  checkOut: string;
  occupancy: { adults: number; childAges: number[] };
  // Null is reserved for historical requests whose board cannot be established.
  mealPlan: MealPlan | null;
  source: Record<string, unknown>;
  note: string;
  attentionReason: InquiryAttentionReason | null;
  currentOfferId: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OfferRecord = {
  id: string;
  hotelId: string;
  inquiryId: string;
  version: number;
  state: "active" | "accepted" | "expired" | "revoked";
  publicTokenHash: string;
  snapshot: Record<string, unknown>;
  expiresAt: Date;
  acceptedAt: Date | null;
  selectedOptionIndex: number | null;
  revokedAt: Date | null;
  createdAt: Date;
};

export type DeliveryRecord = {
  id: string;
  hotelId: string;
  inquiryId: string | null;
  offerVersionId: string | null;
  kind: string;
  channel: "email" | "whatsapp" | "push";
  state: "scheduled" | "processing" | "provider_accepted" | "delivered" | "failed" | "unknown" | "cancelled";
  idempotencyKey: string;
  recipient: string;
  payload: Record<string, unknown>;
  attemptCount: number;
  nextAttemptAt: Date;
  providerMessageId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type InquiryBundleCreate = {
  inquiry: Omit<InquiryRecord, "reservationNumber" | "currentOfferId" | "createdAt" | "updatedAt">;
  offer?: Omit<OfferRecord, "createdAt">;
  deliveries?: Array<Omit<DeliveryRecord, "createdAt" | "updatedAt">>;
};

export type InquiryBundle = {
  inquiry: InquiryRecord;
  offer: OfferRecord | null;
  deliveries: DeliveryRecord[];
  replayed: boolean;
};

export type DashboardFacts = {
  hotel: HotelProfile;
  inquiries: InquiryRecord[];
  offers: OfferRecord[];
  deliveries: DeliveryRecord[];
};

export type DashboardCounts = {
  total: number;
  new: number;
  offerSent: number;
  requiresConfirmation: number;
  requiresConfirmationTotalCents: number;
  needsAttention: number;
};

export type DashboardPageFacts = DashboardFacts & {
  hasRequests: boolean;
  counts: DashboardCounts;
  pagination: DashboardPagination;
  nextProcessingDeadlineAt: Date | null;
  evaluatedAt: Date;
};

export type ReservationOffersCreate = {
  userId: string;
  inquiryId: string;
  baseOfferId: string | null;
  offer: Omit<OfferRecord, "createdAt" | "version">;
  deliveries: Array<Omit<DeliveryRecord, "createdAt" | "updatedAt">>;
  now: Date;
};

export type ManualOfferSentCreate = {
  offerId: string;
  userId: string;
  inquiryId: string;
  channel: "email" | "whatsapp";
  language: "en" | "it";
  idempotencyKey: string;
  now: Date;
};

export interface AutomationRepository {
  findOfferSettingsForHotel(hotelId: string): Promise<OfferSettings | null>;
  findMessageSettingsForHotel(hotelId: string): Promise<MessageSettings | null>;
  saveOfferSettingsForUser(userId: string, settings: OfferSettings): Promise<OfferSettings | null>;
  findPublicHotelByKey(publicKey: string): Promise<HotelProfile | null>;
  findPublicHotelWebsite(hotelId: string): Promise<string | null>;
  listCatalogForHotel(hotelId: string): Promise<{ rooms: RoomProfile[]; ratePeriods: RatePeriodProfile[] }>;
  findInquiryByIdempotency(hotelId: string, idempotencyKey: string): Promise<InquiryRecord | null>;
  createInquiryBundle(input: InquiryBundleCreate): Promise<InquiryBundle>;
  replaceReservationOffers(input: ReservationOffersCreate): Promise<{ replayed: boolean } | null>;
  findOfferByTokenHash(tokenHash: string): Promise<OfferRecord | null>;
  acceptOfferByTokenHash(tokenHash: string, now: Date, selectedOptionIndex: number): Promise<OfferRecord | null>;
  recordManualOfferSentForUser(input: ManualOfferSentCreate): Promise<DeliveryRecord | null>;
  markPaymentLinkSentForUser(userId: string, inquiryId: string, now: Date): Promise<InquiryRecord | null>;
  dashboardFactsForUser(userId: string, inquiryIds?: string[]): Promise<DashboardFacts | null>;
  dashboardPageForUser(userId: string, query: DashboardQuery): Promise<DashboardPageFacts | null>;
}

export interface InventoryRepository {
  createRoomForUser(userId: string, input: RoomCreate): Promise<RoomProfile | null>;
  listRoomsForUser(userId: string): Promise<RoomProfile[]>;
  findRoomForUser(userId: string, roomId: string): Promise<RoomProfile | null>;
  updateRoomForUser(userId: string, roomId: string, input: RoomUpdate): Promise<RoomProfile | null>;
  softDeleteRoomForUser(userId: string, roomId: string): Promise<boolean>;
  createRatePeriodForUser(
    userId: string,
    roomId: string,
    input: RatePeriodCreate,
  ): Promise<RatePeriodProfile | null>;
  listRatePeriodsForUser(userId: string, roomId: string): Promise<RatePeriodProfile[] | null>;
  findRatePeriodForUser(userId: string, roomId: string, ratePeriodId: string): Promise<RatePeriodProfile | null>;
  updateRatePeriodForUser(
    userId: string,
    roomId: string,
    ratePeriodId: string,
    input: RatePeriodUpdate,
  ): Promise<RatePeriodProfile | null>;
  softDeleteRatePeriodForUser(userId: string, roomId: string, ratePeriodId: string): Promise<boolean>;
  findRateOverlapsForUser(input: {
    userId: string;
    roomId: string;
    planCode: string;
    mealPlan: MealPlan;
    start: string;
    endExclusive: string;
    excludeRatePeriodId?: string;
  }): Promise<RateOverlap[] | null>;
}

export interface SystemRepository {
  checkDatabase(): Promise<boolean>;
}

export type NotificationPreferences = {
  userId: string;
  pushAllRequests: boolean;
  emailIncomingRequests: boolean;
  emailAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PushDeviceRecord = {
  id: string;
  userId: string;
  expoPushToken: string;
  platform: string;
  deviceName: string | null;
  active: boolean;
  lastRegisteredAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type NotificationTarget = {
  user: PublicUser;
  preferences: NotificationPreferences | null;
  devices: PushDeviceRecord[];
};

export interface NotificationRepository {
  findPreferencesForUser(userId: string): Promise<{ user: PublicUser; preferences: NotificationPreferences | null; devices: PushDeviceRecord[] } | null>;
  upsertPreferencesForUser(userId: string, input: Pick<NotificationPreferences, "pushAllRequests" | "emailIncomingRequests" | "emailAddress">): Promise<NotificationPreferences | null>;
  registerPushDeviceForUser(userId: string, input: { expoPushToken: string; platform: string; deviceName: string | null }): Promise<PushDeviceRecord | null>;
  deactivatePushDeviceForUser(userId: string, expoPushToken: string): Promise<boolean>;
  deactivatePushDeviceByToken(expoPushToken: string): Promise<void>;
  listTargetsForHotel(hotelId: string): Promise<NotificationTarget[]>;
}

export type MessageTemplates = { emailSubjectTemplate: string; emailBodyTemplate: string; whatsappBodyTemplate: string };
export type MessageSettings = {
  templateLanguage?: "en" | "it" | undefined;
  translations?: Partial<Record<"en" | "it", MessageTemplates>> | undefined;
  hotelId: string;
  emailSubjectTemplate: string;
  emailBodyTemplate: string;
  whatsappBodyTemplate: string;
  createdAt: Date;
  updatedAt: Date;
};

export type MessageSettingsUpdate = Pick<
  MessageSettings,
  "emailSubjectTemplate" | "emailBodyTemplate" | "whatsappBodyTemplate" | "templateLanguage" | "translations"
>;

export type ConnectionKind = "google" | "microsoft" | "smtp" | "waha";
export type ConnectionRecord = {
  id: string;
  hotelId: string;
  kind: ConnectionKind;
  state: "disconnected" | "connecting" | "connected" | "attention";
  encryptedCredentials: string | null;
  metadata: Record<string, unknown>;
  lastCheckedAt: Date | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface ChannelRepository {
  // The callback gets a scoped repository using the same lock/session. Do not use
  // an outer repository from inside it or nest a lock for another hotel.
  mailConnectionSignal(): AbortSignal | undefined;
  withMailConnectionLock<T>(hotelId: string, work: (repository: ChannelRepository) => Promise<T>): Promise<T>;
  listConnectionsForHotel(hotelId: string): Promise<ConnectionRecord[]>;
  findMessageSettingsForUser(userId: string): Promise<MessageSettings | null>;
  upsertMessageSettingsForUser(
    userId: string,
    input: MessageSettingsUpdate,
  ): Promise<MessageSettings | null>;
  listConnectionsForUser(userId: string): Promise<ConnectionRecord[] | null>;
  findConnectionForUser(userId: string, kind: ConnectionKind): Promise<ConnectionRecord | null>;
  configureWahaForUser(input: {
    userId: string;
    encryptedCredentials: string;
    metadata: Record<string, unknown>;
  }): Promise<ConnectionRecord | null>;
  configureMailForUser(input: { userId: string; kind: "smtp"; encryptedCredentials: string; metadata: Record<string, unknown> }): Promise<ConnectionRecord | null>;
  beginMailOAuthForUser(input: { userId: string; kind: "google" | "microsoft"; nonceHash: string; expiresAt: Date; metadata: Record<string, unknown> }): Promise<{ hotelId: string; connection: ConnectionRecord } | null>;
  consumeMailOAuthState(input: { hotelId: string; kind: "google" | "microsoft"; nonceHash: string; now: Date }): Promise<ConnectionRecord | null>;
  beginGoogleOAuthForUser(input: {
    userId: string;
    nonceHash: string;
    expiresAt: Date;
  }): Promise<{ hotelId: string; connection: ConnectionRecord } | null>;
  consumeGoogleOAuthState(input: {
    hotelId: string;
    nonceHash: string;
    now: Date;
  }): Promise<ConnectionRecord | null>;
  activateMailConnectionForHotel(input: {
    hotelId: string;
    kind: "google" | "microsoft" | "smtp";
    encryptedCredentials: string;
    metadata: Record<string, unknown>;
    lastCheckedAt: Date;
    lastErrorCode: null;
    expectedOAuthAttemptId?: string;
  }): Promise<ConnectionRecord | null>;
  updateConnectionForHotel(input: {
    hotelId: string;
    kind: ConnectionKind;
    state: ConnectionRecord["state"];
    encryptedCredentials?: string | null;
    expectedEncryptedCredentials?: string;
    expectedOAuthAttemptId?: string;
    metadata?: Record<string, unknown>;
    lastCheckedAt: Date;
    lastErrorCode: string | null;
  }): Promise<ConnectionRecord | null>;
  createTestDeliveryForUser(
    userId: string,
    input: Omit<DeliveryRecord, "hotelId" | "createdAt" | "updatedAt">,
  ): Promise<DeliveryRecord | null>;
}

export type WhatsAppSupportRecord = {
  hotel: Pick<HotelProfile, "id" | "name" | "city" | "email" | "phone">;
  connection: ConnectionRecord | null;
  lastSuccessfulMessageAt: Date | null;
  lastFailedMessageAt: Date | null;
  lastDeliveryErrorCode: string | null;
};

export interface PlatformAdminRepository {
  listWhatsAppSupportRecords(): Promise<WhatsAppSupportRecord[]>;
  findWhatsAppSupportRecord(hotelId: string): Promise<WhatsAppSupportRecord | null>;
  updateWhatsAppConnection(input: {
    hotelId: string;
    state: ConnectionRecord["state"];
    metadata: Record<string, unknown>;
    lastCheckedAt: Date;
    lastErrorCode: string | null;
  }): Promise<ConnectionRecord | null>;
}

export type ClaimedOfferDelivery = {
  delivery: DeliveryRecord;
  offer: OfferRecord | null;
  hotel: HotelProfile | null;
  settings: MessageSettings | null;
  connection: ConnectionRecord | null;
};

export interface DeliveryWorkerRepository {
  claimNextOfferDelivery(now: Date): Promise<ClaimedOfferDelivery | null>;
  settleClaimedDelivery(input: {
    deliveryId: string;
    state: "scheduled" | "provider_accepted" | "failed" | "unknown";
    attemptCount: number;
    nextAttemptAt: Date;
    providerMessageId: string | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    processedAt: Date | null;
    now: Date;
  }): Promise<boolean>;
}

export type Repositories = {
  auth: AuthRepository;
  hotels: HotelRepository;
  inventory: InventoryRepository;
  automation: AutomationRepository;
  channels: ChannelRepository;
  platformAdmin: PlatformAdminRepository;
  deliveryWorker: DeliveryWorkerRepository;
  notifications: NotificationRepository;
  system: SystemRepository;
};
