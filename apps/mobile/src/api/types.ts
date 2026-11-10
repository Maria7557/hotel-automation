export type RequestStatus = "payment" | "completed" | "attention" | "waiting" | "new";
export type { DashboardQuery, DashboardPagination } from "@hotel/contracts";
export type { ClientFilters, ClientFilterOptions } from "@hotel/contracts";
export type { ManualInquiryInput, ManualInquiryResult, ManualRequestSource } from "@hotel/contracts";
import type { ManualRequestSource, ReservationOffer } from "@hotel/contracts";

export type DeliverySummary = {
  status: "sent" | "pending" | "failed" | "unused";
  state?: "scheduled" | "processing" | "provider_accepted" | "delivered" | "failed" | "unknown" | "cancelled";
  attemptCount?: number;
  recipient?: string;
  lastErrorCode?: string | null;
  processedAt?: string | null;
};

export type HotelRequest = {
  id: string;
  reservationNumber: string;
  guestName: string;
  mealPlan: MealPlan | null;
  checkIn: string;
  checkOut: string;
  occupancy: { adults: number; childAges: number[] };
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
  processingDeadlineAt?: string | null;
  note?: string;
  locale?: string;
  receivedVia?: ManualRequestSource | null;
  offerExpiresAt?: string | null;
  offerSentAt?: string | null;
  acceptedAt?: string | null;
  paymentLinkSentAt?: string | null;
  currentOfferId?: string | null;
  offers?: ReservationOffer[];
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
  pagination: import("@hotel/contracts").DashboardPagination;
  nextProcessingDeadlineAt?: string | null;
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
  uiLanguage?: "en" | "it" | null;
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

export type MealPlan = "BB" | "HB" | "FB";

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
  boardAdultCents: number;
  boardChildCents: number;
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
        nights: Array<{ date: string; totalCents: number; baseCents: number; extraAdultCents: number; extraChildCents: number; boardCents: number }>;
      };
    }
  | { ok: false; issues: Array<{ type: string; date?: string }> };

export type MessageChannel = "email" | "whatsapp";

export type MessageTemplates = { emailSubjectTemplate: string; emailBodyTemplate: string; whatsappBodyTemplate: string };
export type MessageSettings = {
  templateLanguage?: "en" | "it";
  translations?: Partial<Record<"en" | "it", MessageTemplates>>;
  emailSubjectTemplate: string;
  emailBodyTemplate: string;
  whatsappBodyTemplate: string;
  allowedVariables: string[];
};

export type MessageSettingsInput = Omit<MessageSettings, "allowedVariables">;

export type MessageOfferContext = {
  url: string;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  roomNames: string[];
};

export type MessagePreview =
  | { channel: "email"; subject: string; text: string; html: string; offer: MessageOfferContext }
  | { channel: "whatsapp"; text: string; offer: MessageOfferContext };

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
  phoneNumber?: string | null;
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

export type NotificationSettings = {
  pushPaymentsAndErrors: true;
  pushAllRequests: boolean;
  pushDeviceRegistered: boolean;
  pushDeviceCount: number;
  emailIncomingRequests: boolean;
  emailAddress: string;
  emailDeliveryAvailable: boolean;
};

export type ClientProfile = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  locale: string;
  notes: string;
  source: "manual" | "inquiry";
  firstInquiryAt: string | null;
  lastInquiryAt: string | null;
  createdAt: string;
  requestCount: number;
};
export type ClientInput = { name: string; email: string | null; phone: string | null; locale: string; notes: string };
export type ClientPage = { clients: ClientProfile[]; nextCursor: string | null };
export type ClientHistory = { requests: HotelRequest[]; nextCursor: string | null };
export type RequestClientStatus = { inquiryId: string; inContacts: boolean; clientId: string | null };
