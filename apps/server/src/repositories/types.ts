export type UserRecord = {
  id: string;
  email: string;
  displayName: string | null;
  passwordHash: string | null;
  googleSubject: string | null;
  appleSubject: string | null;
};

export type PublicUser = Pick<UserRecord, "id" | "email" | "displayName">;

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
  mealPlan: "room_only" | "breakfast";
  start: string;
  endExclusive: string;
  nightlyBaseCents: number;
  currency: string;
  includedAdults: number;
  includedChildren: number;
  extraAdultCents: number;
  extraChildCents: number;
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
  | "missing_rate"
  | "ambiguous_rate"
  | "invalid_guest_data"
  | "manual_review";

export type InquiryRecord = {
  id: string;
  hotelId: string;
  idempotencyKey: string;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  locale: string;
  checkIn: string;
  checkOut: string;
  occupancy: { adults: number; childAges: number[] };
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
  inquiry: Omit<InquiryRecord, "currentOfferId" | "createdAt" | "updatedAt">;
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

export interface AutomationRepository {
  findPublicHotelByKey(publicKey: string): Promise<HotelProfile | null>;
  listCatalogForHotel(hotelId: string): Promise<{ rooms: RoomProfile[]; ratePeriods: RatePeriodProfile[] }>;
  findInquiryByIdempotency(hotelId: string, idempotencyKey: string): Promise<InquiryRecord | null>;
  createInquiryBundle(input: InquiryBundleCreate): Promise<InquiryBundle>;
  findOfferByTokenHash(tokenHash: string): Promise<OfferRecord | null>;
  acceptOfferByTokenHash(tokenHash: string, now: Date, selectedOptionIndex: number): Promise<OfferRecord | null>;
  dashboardFactsForUser(userId: string): Promise<DashboardFacts | null>;
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
    start: string;
    endExclusive: string;
    excludeRatePeriodId?: string;
  }): Promise<RateOverlap[] | null>;
}

export interface SystemRepository {
  checkDatabase(): Promise<boolean>;
}

export type MessageSettings = {
  hotelId: string;
  emailSubjectTemplate: string;
  emailBodyTemplate: string;
  whatsappBodyTemplate: string;
  createdAt: Date;
  updatedAt: Date;
};

export type MessageSettingsUpdate = Pick<
  MessageSettings,
  "emailSubjectTemplate" | "emailBodyTemplate" | "whatsappBodyTemplate"
>;

export type ConnectionKind = "google" | "waha";
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
  updateConnectionForHotel(input: {
    hotelId: string;
    kind: ConnectionKind;
    state: ConnectionRecord["state"];
    encryptedCredentials?: string;
    metadata?: Record<string, unknown>;
    lastCheckedAt: Date;
    lastErrorCode: string | null;
  }): Promise<ConnectionRecord | null>;
  createTestDeliveryForUser(
    userId: string,
    input: Omit<DeliveryRecord, "hotelId" | "createdAt" | "updatedAt">,
  ): Promise<DeliveryRecord | null>;
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
  deliveryWorker: DeliveryWorkerRepository;
  system: SystemRepository;
};
