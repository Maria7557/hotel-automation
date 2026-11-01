export type RequestStatus = "payment" | "attention" | "waiting" | "new";

export type DeliverySummary = {
  status: "sent" | "pending" | "failed" | "unused";
  recipient?: string;
  lastErrorCode?: string | null;
  processedAt?: string | null;
};

export type HotelRequest = {
  id: string;
  guestName: string;
  stayLabel: string;
  guestLabel: string;
  roomLabel: string;
  totalLabel: string;
  totalCents: number;
  currency: string;
  receivedAt: string;
  status: RequestStatus;
  statusLabel: string;
  nextAction?: string;
  attentionReason?: string | null;
  email: DeliverySummary;
  whatsapp: DeliverySummary;
};

export type DashboardSnapshot = {
  totalCount: number;
  newCount: number;
  waitingCount: number;
  paymentPendingCount: number;
  paymentPendingTotalCents: number;
  attentionCount: number;
  requests: HotelRequest[];
};

export type HotelProfile = {
  id?: string;
  name: string;
  city: string;
  countryCode: string;
  email: string;
  currency: string;
  locale: string;
  timezone: string;
  description: string;
  phone: string;
  website: string;
  logoUrl: string;
  photoUrls: string[];
  termsText: string;
  publicKey: string;
  allowedOrigins: string[];
};

export type HotelProfileInput = Omit<
  HotelProfile,
  "id" | "currency" | "timezone" | "publicKey" | "allowedOrigins"
>;

export type HotelIntakeSettings = Pick<HotelProfile, "publicKey" | "allowedOrigins">;

export type SessionUser = {
  id: string;
  email: string;
  displayName: string | null;
};

export type AuthSession = {
  accessToken: string;
  expiresAt: string;
  user: SessionUser;
};

export type BedType = "single" | "double" | "queen" | "king" | "sofa_bed" | "bunk" | "crib";

export type RoomBed = { type: BedType; count: number };

export type Room = {
  id: string;
  name: string;
  description: string | null;
  maxAdults: number;
  maxChildren: number;
  maxGuests: number;
  beds: RoomBed[];
  amenities: string[];
  photoUrls: string[];
  active: boolean;
};

export type RoomInput = Omit<Room, "id">;

export type MealPlan = "room_only" | "breakfast";

export type RatePeriod = {
  id: string;
  roomId: string;
  planCode: string;
  planName: string;
  mealPlan: MealPlan;
  start: string;
  endInclusive: string;
  endExclusive: string;
  nightlyBaseCents: number;
  currency: "EUR";
  includedAdults: number;
  includedChildren: number;
  extraAdultCents: number;
  extraChildCents: number;
  breakfastAdultCents: number;
  breakfastChildCents: number;
  maxChildAge: number;
  minNights: number;
  active: boolean;
};

export type RatePeriodInput = Omit<RatePeriod, "id" | "roomId" | "endExclusive">;

export type RatePreview =
  | {
      ok: true;
      price: {
        currency: "EUR";
        totalCents: number;
        nights: Array<{ date: string; totalCents: number; baseCents: number; extraAdultCents: number; extraChildCents: number; breakfastCents: number }>;
      };
    }
  | { ok: false; issues: Array<{ type: string; date?: string }> };

export type MessageChannel = "email" | "whatsapp";

export type MessageSettings = {
  emailSubjectTemplate: string;
  emailBodyTemplate: string;
  whatsappBodyTemplate: string;
  allowedVariables: string[];
};

export type MessageSettingsInput = Omit<MessageSettings, "allowedVariables">;

export type MessagePreview =
  | { channel: "email"; subject: string; text: string; html: string }
  | { channel: "whatsapp"; text: string };

export type TestSendResult = {
  provider: "fake" | "gmail" | "waha";
  accepted: boolean;
  delivery: {
    id: string;
    channel: MessageChannel;
    state: string;
    recipient: string;
    lastErrorCode: string | null;
    createdAt: string;
  };
  rendered: MessagePreview;
};

export type ConnectionStatus = {
  kind: "mail" | "waha";
  provider?: "google" | "microsoft" | "smtp" | null;
  senderEmail?: string | null;
  configured: boolean;
  available: boolean;
  state: string;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
  baseUrl?: string | null;
  sessionName?: string | null;
};

export type PlatformWhatsAppSession = {
  hotelId: string;
  hotelName: string;
  city: string;
  contactEmail: string | null;
  contactPhone: string | null;
  configured: boolean;
  health: "connected" | "connecting" | "attention" | "disconnected";
  providerStatus: string;
  phoneNumber: string | null;
  pushName: string | null;
  engine: string | null;
  messageCapping: { status: string; totalQuota: number | null; usedQuota: number | null; cycleEnd: number | null } | null;
  sessionName: string | null;
  lastCheckedAt: string | null;
  lastSuccessfulMessageAt: string | null;
  lastFailedMessageAt: string | null;
  lastErrorCode: string | null;
};

export type PlatformWhatsAppSnapshot = {
  provider: { configured: boolean; reachable: boolean; errorCode: string | null };
  counts: { total: number; connected: number; connecting: number; attention: number; disconnected: number };
  sessions: PlatformWhatsAppSession[];
};
