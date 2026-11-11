import { locale as uiLocale, getLanguage, t } from "../i18n";
import { requestLabel } from "../requests/status";
import { AUTOMATIC_SENDING_TIMEOUT_MS, AUTOMATIC_SENDING_TIMEOUT_REASON } from "@hotel/contracts";
import { DASHBOARD_PAGE_SIZE, OFFER_VALIDITY_MS, dashboardQuerySchema, type DashboardQuery, type InquiryFormInput, type OfferEditorData, type OfferQuote, type OfferSettings, type ReservationOffer, type SendReservationOffersInput } from "@hotel/contracts";
import { demoOfferEditor, getDemoOfferSettings, prefillDemoOffers, quoteDemoOffer, saveDemoOfferSettings } from "./demo-offers";
import { demoMessageSettings, renderDemoMessagePreview } from "./demo-message-preview";
import type { ClientFilters, ClientFilterOptions, ClientPage, ClientHistory, ClientInput, ClientProfile, OfferShareMessage, RequestClientStatus } from "./types";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { mockDashboard, refreshDemoSendingStatuses } from "./mock";
import type {
  AuthSession,
  DashboardSnapshot,
  DeliverySummary,
  HotelProfile,
  HotelRequest,
  ManualInquiryInput,
  ManualInquiryResult,
  ManualRequestSource,
  HotelProfileInput,
  HotelIntakeSettings,
  ConnectionStatus,
  MessageChannel,
  MessagePreview,
  MessageSettings,
  MessageSettingsInput,
  NotificationSettings,
  PlatformWhatsAppSession,
  PlatformWhatsAppSnapshot,
  RatePeriod,
  RatePeriodInput,
  RatePreview,
  Room,
  RoomInput,
  SessionUser,
  TestSendResult,
} from "./types";

const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "");


const sessionTokenKey = "hotel.session.token";
const webCookieSession = "web-cookie-session";
let volatileWebToken: string | null = null;

type ApiErrorPayload = {
  error?: { code?: string; message?: string; details?: unknown };
};

type ApiHotel = {
  id?: string;
  name: string;
  city?: string;
  countryCode?: string;
  locale?: string;
  email?: string | null;
  currency?: string;
  timezone?: string;
  description?: string | null;
  phone?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  photoUrls?: string[];
  termsText?: string | null;
  publicKey?: string;
  allowedOrigins?: string[];
};

type ApiDeliveryState = NonNullable<DeliverySummary["state"]>;

type ApiDashboard = {
  nextProcessingDeadlineAt?: string | null;
  counts: { total: number; new: number; offerSent: number; requiresConfirmation: number; requiresConfirmationTotalCents: number; needsAttention: number };
  pagination: DashboardSnapshot["pagination"];
  inquiries: Array<{
    id: string;
    reservationNumber: string;
    guestName: string;
    guestEmail: string | null;
    guestPhone: string | null;
    locale: string;
    note: string;
    receivedVia?: ManualRequestSource | null;
    offerExpiresAt: string | null;
    offerSentAt: string | null;
    acceptedAt: string | null;
    paymentLinkSentAt: string | null;
    mealPlan: "BB" | "HB" | "FB" | null;
    checkIn: string;
    checkOut: string;
    occupancy: { adults: number; childAges: number[] };
    offerSummary: { roomName: string; totalCents: number; currency: string } | null;
    currentOfferId?: string | null;
    offers?: ReservationOffer[];
    channelStates: { email: ApiDeliveryState | null; whatsapp: ApiDeliveryState | null };
    channelDetails: {
      email: { state: ApiDeliveryState; attemptCount?: number; recipient: string; lastErrorCode: string | null; processedAt: string | null } | null;
      whatsapp: { state: ApiDeliveryState; attemptCount?: number; recipient: string; lastErrorCode: string | null; processedAt: string | null } | null;
    };
    workflowState: "new" | "offer_sent" | "requires_confirmation" | "payment_link_sent" | "needs_attention";
    attentionReason: string | null;
    processingDeadlineAt?: string | null;
    createdAt: string;
  }>;
};

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function requireApiUrl(): string {
  if (!apiUrl) {
    throw new ApiError(
      "API_NOT_CONFIGURED",
      "Set EXPO_PUBLIC_API_URL to use a real account.",
    );
  }
  return apiUrl;
}

async function readToken(): Promise<string | null> {
  if (Platform.OS === "web") return volatileWebToken;
  return SecureStore.getItemAsync(sessionTokenKey);
}

async function saveToken(token: string): Promise<void> {
  if (Platform.OS === "web") {
    // The real web token is stored only in the server-issued HttpOnly cookie.
    volatileWebToken = webCookieSession;
    return;
  }
  await SecureStore.setItemAsync(sessionTokenKey, token, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

async function clearToken(): Promise<void> {
  if (Platform.OS === "web") {
    volatileWebToken = null;
    return;
  }
  await SecureStore.deleteItemAsync(sessionTokenKey);
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
  clearUnauthorized = true,
): Promise<T> {
  const baseUrl = requireApiUrl();
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  headers.set("Accept-Language", getLanguage());
  if (options.body) headers.set("Content-Type", "application/json");
  if (token && token !== webCookieSession) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
      ...(Platform.OS === "web" ? { credentials: "include" as const } : {}),
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", "Could not reach the server. Check your connection and try again.");
  }

  if (response.status === 204) return undefined as T;

  const body = (await response.json().catch(() => null)) as (ApiErrorPayload & T) | null;
  if (!response.ok) {
    if (response.status === 401 && token && clearUnauthorized) await clearToken();
    const serverError = body?.error;
    throw new ApiError(
      serverError?.code ?? "REQUEST_FAILED",
      serverError?.message ?? "The server could not complete the request.",
      response.status,
      serverError?.details,
    );
  }

  if (!body) throw new ApiError("INVALID_RESPONSE", "The server returned an empty response.", response.status);
  return body;
}

function mapHotel(hotel: ApiHotel): HotelProfile {
  return {
    ...(hotel.id ? { id: hotel.id } : {}),
    name: hotel.name,
    city: hotel.city?.trim() ?? "",
    countryCode: hotel.countryCode?.trim().toUpperCase() ?? "IT",
    email: hotel.email ?? "",
    currency: hotel.currency ?? "EUR",
    locale: hotel.locale ?? "en-GB",
    timezone: hotel.timezone ?? "Europe/Rome",
    description: hotel.description ?? "",
    phone: hotel.phone ?? "",
    website: hotel.website ?? "",
    logoUrl: hotel.logoUrl ?? "",
    photoUrls: hotel.photoUrls ?? [],
    termsText: hotel.termsText ?? "",
    publicKey: hotel.publicKey ?? "",
    allowedOrigins: hotel.allowedOrigins ?? [],
  };
}

async function authenticate(
  path: "/v1/auth/register" | "/v1/auth/login" | "/v1/auth/social",
  payload: Record<string, unknown>,
): Promise<AuthSession> {
  const response = await apiRequest<{ data: AuthSession }>(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  await saveToken(response.data.accessToken);
  return response.data;
}

async function requireToken(): Promise<string> {
  const token = await readToken();
  if (!token) throw new ApiError("NO_SESSION", "No saved session was found.", 401);
  return token;
}

// Contacts have their own short timeout and never participate in dashboard loading.
async function clientRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await requireToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try { return await apiRequest<T>(path, { ...options, signal: controller.signal }, token, false); }
  finally { clearTimeout(timeout); }
}

export const apiClient = {
  async listClients(search = "", cursor?: string, filters: ClientFilters = {}): Promise<ClientPage> {
    const query = new URLSearchParams({ search, ...(cursor ? { cursor } : {}) });
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) query.set(key, String(value));
    }
    return (await clientRequest<{ data: ClientPage }>(`/v1/clients?${query}`)).data;
  },
  async getClientFilterOptions(): Promise<ClientFilterOptions> {
    return (await clientRequest<{ data: ClientFilterOptions }>("/v1/clients/filter-options")).data;
  },
  async createClient(input: ClientInput): Promise<{ client: ClientProfile; created: boolean }> {
    return (await clientRequest<{ data: { client: ClientProfile; created: boolean } }>("/v1/clients", { method: "POST", body: JSON.stringify(input) })).data;
  },
  async getClient(id: string): Promise<ClientProfile> {
    return (await clientRequest<{ data: { client: ClientProfile } }>(`/v1/clients/${encodeURIComponent(id)}`)).data.client;
  },
  async getClientHistory(id: string, cursor?: string): Promise<ClientHistory> {
    const page = (await clientRequest<{ data: { requests: Array<{ id: string }>; nextCursor: string | null } }>(`/v1/clients/${encodeURIComponent(id)}/requests${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`)).data;
    if (!page.requests.length) return { ...page, requests: [] };
    const token = await requireToken();
    const response = await apiRequest<{ data: { inquiries: ApiDashboard["inquiries"] } }>("/v1/inquiries/summaries", {
      method: "POST", body: JSON.stringify({ inquiryIds: page.requests.map((request) => request.id) }),
    }, token);
    const requests = new Map(response.data.inquiries.map((inquiry) => [inquiry.id, mapRequest(inquiry)]));
    return { nextCursor: page.nextCursor, requests: page.requests.flatMap(({ id }) => requests.get(id) ? [requests.get(id)!] : []) };
  },
  async getRequestClientStatuses(inquiryIds: string[]): Promise<RequestClientStatus[]> {
    return (await clientRequest<{ data: { statuses: RequestClientStatus[] } }>("/v1/clients/request-statuses", { method: "POST", body: JSON.stringify({ inquiryIds }) })).data.statuses;
  },
  async addRequestClient(inquiryId: string): Promise<ClientProfile> {
    return (await clientRequest<{ data: { client: ClientProfile } }>(`/v1/inquiries/${encodeURIComponent(inquiryId)}/client`, { method: "POST" })).data.client;
  },
  register: (input: { displayName: string; email: string; password: string }) =>
    authenticate("/v1/auth/register", input),

  login: (input: { email: string; password: string }) =>
    authenticate("/v1/auth/login", input),

  socialLogin: (input: { provider: "google" | "apple"; idToken: string }) =>
    authenticate("/v1/auth/social", input),

  async getSession(): Promise<SessionUser | null> {
    const token = await readToken();
    if (!token && Platform.OS !== "web") return null;
    try {
      const response = await apiRequest<{ data: { user: SessionUser } }>(
        "/v1/auth/session",
        {},
        token,
      );
      if (Platform.OS === "web") volatileWebToken = webCookieSession;
      return response.data.user;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await clearToken();
        if (Platform.OS === "web") return null;
      }
      throw error;
    }
  },

  async updateLanguage(uiLanguage: "en" | "it"): Promise<void> {
    const token = await requireToken();
    await apiRequest("/v1/auth/preferences", { method: "PATCH", body: JSON.stringify({ uiLanguage }) }, token);
  },

  async logout(): Promise<void> {
    const token = await readToken();
    try {
      if (token) await apiRequest<void>("/v1/auth/logout", { method: "POST" }, token);
    } finally {
      await clearToken();
    }
  },

  async createHotel(input: {
    name: string;
    city: string;
    countryCode: string;
    locale: string;
    email: string;
    logoUrl?: string;
  }): Promise<HotelProfile> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { hotel: ApiHotel } }>(
      "/v1/hotel",
      {
        method: "POST",
        body: JSON.stringify({ ...input, currency: "EUR", timezone: "Europe/Rome" }),
      },
      token,
    );
    return mapHotel(response.data.hotel);
  },

  async getHotel(): Promise<HotelProfile> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { hotel: ApiHotel } }>("/v1/hotel", {}, token);
    return mapHotel(response.data.hotel);
  },

  async updateHotel(input: HotelProfileInput): Promise<HotelProfile> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { hotel: ApiHotel } }>(
      "/v1/hotel",
      {
        method: "PATCH",
        body: JSON.stringify({
          ...input,
          email: input.email || null,
          phone: input.phone || null,
          website: input.website || null,
          description: input.description || null,
          logoUrl: input.logoUrl || null,
          termsText: input.termsText || null,
        }),
      },
      token,
    );
    return mapHotel(response.data.hotel);
  },

  async updateIntakeSettings(allowedOrigins: string[]): Promise<HotelIntakeSettings> {
    const token = await requireToken();
    const response = await apiRequest<{ data: HotelIntakeSettings }>(
      "/v1/hotel/intake-settings",
      { method: "PUT", body: JSON.stringify({ allowedOrigins }) },
      token,
    );
    return response.data;
  },

  async listRooms(): Promise<Room[]> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { rooms: Room[] } }>("/v1/rooms", {}, token);
    return response.data.rooms;
  },

  async createRoom(input: RoomInput): Promise<Room> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { room: Room } }>(
      "/v1/rooms",
      { method: "POST", body: JSON.stringify(input) },
      token,
    );
    return response.data.room;
  },

  async updateRoom(roomId: string, input: RoomInput): Promise<Room> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { room: Room } }>(
      `/v1/rooms/${encodeURIComponent(roomId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
      token,
    );
    return response.data.room;
  },

  async listRates(roomId: string): Promise<RatePeriod[]> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { ratePeriods: RatePeriod[] } }>(
      `/v1/rooms/${encodeURIComponent(roomId)}/rates`,
      {},
      token,
    );
    return response.data.ratePeriods;
  },

  async createRate(roomId: string, input: RatePeriodInput): Promise<RatePeriod> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { ratePeriod: RatePeriod } }>(
      `/v1/rooms/${encodeURIComponent(roomId)}/rates`,
      { method: "POST", body: JSON.stringify(input) },
      token,
    );
    return response.data.ratePeriod;
  },

  async updateRate(roomId: string, ratePeriodId: string, input: RatePeriodInput): Promise<RatePeriod> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { ratePeriod: RatePeriod } }>(
      `/v1/rooms/${encodeURIComponent(roomId)}/rates/${encodeURIComponent(ratePeriodId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
      token,
    );
    return response.data.ratePeriod;
  },

  async uploadImage(input: { base64: string; mimeType: "image/jpeg" | "image/png" | "image/webp" }): Promise<string> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { url: string } }>(
      "/v1/media/images",
      { method: "POST", body: JSON.stringify(input) },
      token,
    );
    return response.data.url;
  },

  async previewRate(
    roomId: string,
    input: { planCode: string; mealPlan: "BB" | "HB" | "FB"; checkIn: string; checkOut: string; adults: number; childAges: number[] },
  ): Promise<RatePreview> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { preview: RatePreview } }>(
      `/v1/rooms/${encodeURIComponent(roomId)}/rates/preview`,
      {
        method: "POST",
        body: JSON.stringify({
          planCode: input.planCode,
          mealPlan: input.mealPlan,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          occupancy: { adults: input.adults, childAges: input.childAges },
        }),
      },
      token,
    );
    return response.data.preview;
  },

  async getMessageSettings(): Promise<MessageSettings> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { settings: MessageSettings } }>(
      "/v1/hotel/message-settings",
      {},
      token,
    );
    return response.data.settings;
  },

  async updateMessageSettings(input: MessageSettingsInput): Promise<MessageSettings> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { settings: MessageSettings } }>(
      "/v1/hotel/message-settings",
      { method: "PUT", body: JSON.stringify(input) },
      token,
    );
    return response.data.settings;
  },

  async previewMessage(channel: MessageChannel, language?: "en" | "it"): Promise<MessagePreview> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { preview: MessagePreview } }>(
      "/v1/hotel/message-settings/preview",
      { method: "POST", body: JSON.stringify({ channel, sample: { language } }) },
      token,
    );
    return response.data.preview;
  },

  async testMessage(channel: MessageChannel, recipient: string, language?: "en" | "it"): Promise<TestSendResult> {
    const token = await requireToken();
    const response = await apiRequest<{ data: TestSendResult }>(
      "/v1/hotel/message-settings/test-send",
      { method: "POST", body: JSON.stringify({ channel, recipient, sample: { language } }) },
      token,
    );
    return response.data;
  },

  async getConnections(): Promise<ConnectionStatus[]> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { connections: ConnectionStatus[] } }>(
      "/v1/connections",
      {},
      token,
    );
    return response.data.connections;
  },

  async disconnectMail(): Promise<ConnectionStatus> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { connection: ConnectionStatus } }>(
      "/v1/connections/mail",
      { method: "DELETE" },
      token,
    );
    return response.data.connection;
  },

  async connectWaha(): Promise<{ connection: ConnectionStatus; qrCode: string | null }> {
    const token = await requireToken();
    const response = await apiRequest<{
      data: { connection: ConnectionStatus; qrCode: string | null };
    }>(
      "/v1/connections/waha/connect",
      { method: "POST" },
      token,
    );
    return response.data;
  },

  async checkWaha(): Promise<ConnectionStatus> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { connection: ConnectionStatus } }>(
      "/v1/connections/waha/check",
      { method: "POST" },
      token,
    );
    return response.data.connection;
  },

  async disconnectWaha(): Promise<ConnectionStatus> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { connection: ConnectionStatus } }>(
      "/v1/connections/waha",
      { method: "DELETE" },
      token,
    );
    return response.data.connection;
  },

  async getNotificationSettings(): Promise<NotificationSettings> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { settings: NotificationSettings } }>("/v1/notifications/settings", {}, token);
    return response.data.settings;
  },

  async updateNotificationSettings(input: { pushAllRequests: boolean; emailIncomingRequests: boolean; emailAddress: string | null }): Promise<NotificationSettings> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { settings: NotificationSettings } }>(
      "/v1/notifications/settings",
      { method: "PUT", body: JSON.stringify(input) },
      token,
    );
    return response.data.settings;
  },

  async registerPushDevice(input: { expoPushToken: string; platform: "ios" | "android"; deviceName: string | null }): Promise<NotificationSettings> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { settings: NotificationSettings } }>(
      "/v1/notifications/devices",
      { method: "POST", body: JSON.stringify(input) },
      token,
    );
    return response.data.settings;
  },

  async getPlatformAdminAccess(): Promise<boolean> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { enabled: boolean } }>("/v1/platform-admin/access", {}, token);
    return response.data.enabled;
  },

  async getPlatformWhatsAppSessions(): Promise<PlatformWhatsAppSnapshot> {
    const token = await requireToken();
    const response = await apiRequest<{ data: PlatformWhatsAppSnapshot }>(
      "/v1/platform-admin/whatsapp/sessions",
      {},
      token,
    );
    return response.data;
  },

  async restartPlatformWhatsAppSession(hotelId: string): Promise<PlatformWhatsAppSession> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { session: PlatformWhatsAppSession } }>(
      `/v1/platform-admin/whatsapp/hotels/${encodeURIComponent(hotelId)}/restart`,
      { method: "POST" },
      token,
    );
    return response.data.session;
  },

  async startGoogleOAuth(): Promise<{ authorizationUrl: string; expiresAt: string }> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { authorizationUrl: string; expiresAt: string } }>(
      "/v1/connections/google/oauth/start",
      {},
      token,
    );
    return response.data;
  },

  async detectMailProvider(email: string): Promise<{ provider: "google" | "microsoft" | "smtp"; confidence: string }> {
    const token = await requireToken(); const response = await apiRequest<{ data: { provider: "google" | "microsoft" | "smtp"; confidence: string } }>("/v1/connections/mail/detect", { method: "POST", body: JSON.stringify({ email }) }, token); return response.data;
  },
  async startMailOAuth(provider: "google" | "microsoft", email: string): Promise<{ authorizationUrl: string; expiresAt: string }> {
    const token = await requireToken(); const response = await apiRequest<{ data: { authorizationUrl: string; expiresAt: string } }>(`/v1/connections/mail/${provider}/oauth/start`, { method: "POST", body: JSON.stringify({ email }) }, token); return response.data;
  },
  async connectSmtp(input: { email: string; hostname: string; port: 465 | 587; username: string; appPassword: string; encryption: "tls" | "starttls" }): Promise<ConnectionStatus> {
    const token = await requireToken(); const response = await apiRequest<{ data: { connection: ConnectionStatus } }>("/v1/connections/mail/smtp", { method: "POST", body: JSON.stringify(input) }, token); return response.data.connection;
  },

  async createFormRequest(input: InquiryFormInput, idempotencyKey: string, options: { demo?: boolean } = {}): Promise<ManualInquiryResult> {
    if (options.demo) {
      return this.createManualRequest({ ...input, guest: { ...input.guest, email: input.guest.email ?? "", phone: input.guest.phone ?? "" }, receivedVia: "website", sendOffer: !input.note.trim() }, `form:${idempotencyKey}`, options);
    }
    const token = await requireToken();
    const response = await apiRequest<{ data: ManualInquiryResult }>("/v1/inquiries/form", {
      method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input),
    }, token);
    return response.data;
  },

  async createManualRequest(input: ManualInquiryInput, idempotencyKey: string, options: { demo?: boolean } = {}): Promise<ManualInquiryResult> {
    if (options.demo) {
      const id = `manual:${idempotencyKey}`;
      const existing = mockDashboard.requests.find((request) => request.id === id);
      if (existing) return { inquiryId: id, reservationNumber: existing.reservationNumber, automated: false, attentionReason: "manual_review", deliveriesScheduled: 0, replayed: true };
      const reservationNumber = String(Math.max(0, ...mockDashboard.requests.map((request) => Number(request.reservationNumber))) + 1);
      const nights = nightsBetween(input.checkIn, input.checkOut);
      const offerContext = { id, guestName: input.guest.name, checkIn: input.checkIn, checkOut: input.checkOut, occupancy: input.occupancy, mealPlan: input.mealPlan };
      const choices = input.offers ?? (input.sendOffer ? demoOfferEditor(offerContext).suggestions.map(({ roomId, planCode }) => ({ roomId, planCode, note: "" })) : []);
      const currentOfferId = choices.length ? `00000000-0000-4000-8000-${reservationNumber.padStart(12, "0")}` : null;
      const expiresAt = new Date(Date.now() + OFFER_VALIDITY_MS).toISOString();
      const offers: ReservationOffer[] = choices.map((offer, index) => ({
        ...quoteDemoOffer(offerContext, offer), id: `${currentOfferId}:${index}`, status: "available", expiresAt,
      }));
      const first = offers[0];
      mockDashboard.requests.unshift({
        id, reservationNumber, guestName: input.guest.name, mealPlan: input.mealPlan,
        checkIn: input.checkIn, checkOut: input.checkOut, occupancy: input.occupancy,
        stayLabel: `${input.checkIn} — ${input.checkOut} · ${countLabel(nights, "night", "nights")}`,
        guestLabel: `${countLabel(input.occupancy.adults, "adult", "adults")}${input.occupancy.childAges.length ? ` · ${countLabel(input.occupancy.childAges.length, "child", "children")}` : ""}`,
        roomLabel: first?.roomName ?? "No offer created",
        totalLabel: first ? new Intl.NumberFormat(uiLocale(), { style: "currency", currency: "EUR" }).format(first.totalCents / 100) : "—",
        totalCents: first?.totalCents ?? 0, currency: "EUR", currentOfferId, offers,
        offerExpiresAt: offers.length ? expiresAt : null,
        receivedAt: new Date().toISOString(), receivedVia: input.receivedVia,
        status: input.sendOffer && offers.length ? "new" : "attention", statusLabel: requestLabel(input.sendOffer && offers.length ? "new" : "attention"), attentionReason: input.sendOffer && offers.length ? null : "manual_review",
        note: input.note, locale: input.guest.language,
        email: { status: "unused", ...(input.guest.email ? { recipient: input.guest.email } : {}) },
        whatsapp: { status: "unused", ...(input.guest.phone ? { recipient: input.guest.phone } : {}) },
      });
      return { inquiryId: id, reservationNumber, automated: offers.length > 0, attentionReason: input.sendOffer && offers.length ? null : "manual_review", deliveriesScheduled: 0, replayed: false };
    }
    const token = await requireToken();
    const response = await apiRequest<{ data: ManualInquiryResult }>("/v1/inquiries", {
      method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input),
    }, token);
    return response.data;
  },
  async getDashboard(options: { demo?: boolean } & Partial<DashboardQuery> = {}): Promise<DashboardSnapshot> {
    const { demo, ...parameters } = options;
    const query = dashboardQuerySchema.parse({ limit: DASHBOARD_PAGE_SIZE, ...parameters });
    if (options.demo) {
      await new Promise((resolve) => setTimeout(resolve, 240));
      refreshDemoSendingStatuses();
      const requests = mockDashboard.requests;
      const reservationNumber = /^#?\s*(\d+)$/.exec(query.search)?.[1];
      const filtered = requests.filter((request) => (query.status === "all" || request.status === query.status) && (!query.search ||
        (reservationNumber !== undefined ? request.reservationNumber === reservationNumber :
          [request.guestName, request.mealPlan ?? "", request.email.recipient ?? "", request.whatsapp.recipient ?? "", request.stayLabel, request.roomLabel, request.guestLabel, request.statusLabel]
            .some((value) => value.toLocaleLowerCase().includes(query.search.toLocaleLowerCase())))));
      const direction = query.sort === "asc" ? 1 : -1;
      filtered.sort((left, right) => direction * (Date.parse(left.receivedAt) - Date.parse(right.receivedAt) || left.id.localeCompare(right.id)));
      const page = Math.min(query.page, Math.max(1, Math.ceil(filtered.length / query.limit)));
      return { totalCount: requests.length,
        newCount: requests.filter((request) => request.status === "new").length,
        waitingCount: requests.filter((request) => request.status === "waiting").length,
        attentionCount: requests.filter((request) => request.status === "attention").length,
        paymentPendingCount: requests.filter((request) => request.status === "payment").length,
        paymentPendingTotalCents: requests.filter((request) => request.status === "payment").reduce((total, request) => total + request.totalCents, 0),
        pagination: { page, limit: query.limit, total: filtered.length },
        nextProcessingDeadlineAt: requests.filter((request) => request.status === "new" && request.processingDeadlineAt)
          .map((request) => request.processingDeadlineAt!).sort()[0] ?? null,
        requests: filtered.slice((page - 1) * query.limit, page * query.limit),
      };
    }
    const token = await requireToken();
    const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
    const response = await apiRequest<{ data: ApiDashboard }>(`/v1/dashboard?${search}`, {}, token);
    return mapDashboard(response.data);
  },
  async getRequest(id: string, options: { demo?: boolean } = {}): Promise<HotelRequest> {
    if (options.demo) {
      refreshDemoSendingStatuses();
      const request = mockDashboard.requests.find((item) => item.id === id);
      if (!request) throw new ApiError("INQUIRY_NOT_FOUND", "Reservation was not found.");
      return prefillDemoOffers(request);
    }
    const token = await requireToken();
    const response = await apiRequest<{ data: { inquiry: ApiDashboard["inquiries"][number] } }>(`/v1/inquiries/${encodeURIComponent(id)}`, {}, token);
    return mapRequest(response.data.inquiry);
  },
  async getOfferShareMessage(id: string, channel: "email" | "whatsapp", options: { demo?: boolean; language?: "en" | "it" } = {}): Promise<OfferShareMessage> {
    if (options.demo) {
      const preview = renderDemoMessagePreview(channel, { ...demoMessageSettings, templateLanguage: options.language ?? "it" }, apiUrl ?? "https://ospio.online");
      return preview.channel === "email"
        ? { channel, subject: preview.subject, text: preview.text, proposalUrl: preview.offer.url }
        : { channel, text: preview.text, proposalUrl: preview.offer.url };
    }
    const token = await requireToken();
    const response = await apiRequest<{ data: { message: OfferShareMessage } }>(
      `/v1/inquiries/${encodeURIComponent(id)}/share-message?channel=${channel}${options.language ? `&language=${options.language}` : ""}`,
      {},
      token,
    );
    return response.data.message;
  },
  async markManualOfferSent(id: string, channel: "email" | "whatsapp", language: "en" | "it", idempotencyKey: string, options: { demo?: boolean } = {}): Promise<HotelRequest> {
    if (options.demo) {
      const request = mockDashboard.requests.find((item) => item.id === id);
      if (!request) throw new ApiError("INQUIRY_NOT_FOUND", "Request was not found.");
      const recipient = request[channel].recipient;
      if (!recipient || !request.currentOfferId) throw new ApiError("OFFER_NOT_FOUND", "Offer was not found.");
      const sentAt = new Date().toISOString();
      request[channel] = { status: "sent", state: "provider_accepted", attemptCount: 0, recipient, lastErrorCode: null, processedAt: sentAt };
      Object.assign(request, { status: "waiting", statusLabel: requestLabel("waiting"), offerSentAt: sentAt, processingDeadlineAt: null, attentionReason: null, nextAction: undefined });
      return { ...request };
    }
    const token = await requireToken();
    const response = await apiRequest<{ data: { inquiry: ApiDashboard["inquiries"][number] } }>(`/v1/inquiries/${encodeURIComponent(id)}/manual-sent`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ channel, language }),
    }, token);
    return mapRequest(response.data.inquiry);
  },
  async sendReservationOffers(id: string, input: SendReservationOffersInput, idempotencyKey: string, options: { demo?: boolean } = {}): Promise<HotelRequest> {
    if (options.demo) {
      const request = mockDashboard.requests.find((item) => item.id === id);
      if (!request) throw new ApiError("INQUIRY_NOT_FOUND", "Reservation was not found.");
      if (request.acceptedAt || request.paymentLinkSentAt || request.status === "payment" || request.status === "completed") throw new ApiError("RESERVATION_ACCEPTED", "An offer has already been accepted.");
      const currentOfferId = idempotencyKey;
      if (request.currentOfferId === currentOfferId) return request;
      if ((request.currentOfferId ?? null) !== input.baseOfferId) throw new ApiError("OFFERS_CHANGED", "Refresh the reservation before editing.");
      const expiresAt = new Date(Date.now() + OFFER_VALIDITY_MS).toISOString();
      const offers: ReservationOffer[] = input.offers.map((offer, index) => ({
        ...quoteDemoOffer(request, offer), id: `${currentOfferId}:${index}`, status: "available", expiresAt,
      }));
      const first = offers[0]!;
      for (const channel of ["email", "whatsapp"] as const) {
        const recipient = request[channel].recipient;
        request[channel] = recipient ? { status: "pending", state: "scheduled", attemptCount: 0, recipient, lastErrorCode: null, processedAt: null } : { status: "unused" };
      }
      Object.assign(request, { currentOfferId, offers, offerExpiresAt: expiresAt, roomLabel: first.roomName,
        totalCents: first.totalCents, totalLabel: new Intl.NumberFormat(uiLocale(), { style: "currency", currency: first.currency }).format(first.totalCents / 100),
        status: "new", statusLabel: requestLabel("new"), attentionReason: null, nextAction: undefined,
        processingDeadlineAt: new Date(Date.now() + AUTOMATIC_SENDING_TIMEOUT_MS).toISOString() });
      return { ...request };
    }
    const token = await requireToken();
    const response = await apiRequest<{ data: { inquiry: ApiDashboard["inquiries"][number] } }>(`/v1/inquiries/${encodeURIComponent(id)}/offers`, {
      method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input),
    }, token);
    return mapRequest(response.data.inquiry);
  },
  async getOfferSettings(options: { demo?: boolean } = {}): Promise<OfferSettings> {
    if (options.demo) return getDemoOfferSettings();
    const response = await apiRequest<{ data: { settings: OfferSettings } }>("/v1/offer-settings", {}, await requireToken());
    return response.data.settings;
  },
  async saveOfferSettings(settings: OfferSettings, options: { demo?: boolean } = {}): Promise<OfferSettings> {
    if (options.demo) return saveDemoOfferSettings(settings);
    const response = await apiRequest<{ data: { settings: OfferSettings } }>("/v1/offer-settings", { method: "PUT", body: JSON.stringify(settings) }, await requireToken());
    return response.data.settings;
  },
  async getOfferEditor(id: string, options: { demo?: boolean } = {}): Promise<OfferEditorData> {
    if (options.demo) return demoOfferEditor(await this.getRequest(id, options));
    const response = await apiRequest<{ data: OfferEditorData }>(`/v1/inquiries/${encodeURIComponent(id)}/offer-editor`, {}, await requireToken());
    return response.data;
  },
  async previewReservationOffer(id: string, input: SendReservationOffersInput["offers"][number], options: { demo?: boolean } = {}): Promise<OfferQuote> {
    if (options.demo) return quoteDemoOffer(await this.getRequest(id, options), input);
    const response = await apiRequest<{ data: { offer: OfferQuote } }>(`/v1/inquiries/${encodeURIComponent(id)}/offers/preview`, { method: "POST", body: JSON.stringify(input) }, await requireToken());
    return response.data.offer;
  },
  async markPaymentLinkSent(inquiryId: string, options: { demo?: boolean } = {}): Promise<void> {
    if (options.demo) {
      mockDashboard.requests = mockDashboard.requests.map((item) => {
        if (item.id !== inquiryId) return item;
        const { nextAction: _next, ...request } = item;
        return { ...request, status: "completed", statusLabel: requestLabel("completed"), paymentLinkSentAt: new Date().toISOString() };
      });
      return;
    }
    const token = await requireToken();
    await apiRequest(`/v1/inquiries/${encodeURIComponent(inquiryId)}/payment-link-sent`, { method: "POST" }, token);
  },
};

function mapDeliveryState(state: ApiDeliveryState | null): "sent" | "pending" | "failed" | "unused" {
  if (state === null || state === "cancelled") return "unused";
  if (state === "provider_accepted" || state === "delivered") return "sent";
  if (state === "scheduled" || state === "processing") return "pending";
  return "failed";
}

function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.max(0, Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000));
}

function countLabel(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function mapDashboard(input: ApiDashboard): DashboardSnapshot {
  return {
    nextProcessingDeadlineAt: input.nextProcessingDeadlineAt ?? null,
    totalCount: input.counts.total,
    newCount: input.counts.new,
    waitingCount: input.counts.offerSent,
    paymentPendingCount: input.counts.requiresConfirmation,
    paymentPendingTotalCents: input.counts.requiresConfirmationTotalCents,
    attentionCount: input.counts.needsAttention,
    pagination: input.pagination,
    requests: input.inquiries.map(mapRequest),
  };
}

function mapRequest(inquiry: ApiDashboard["inquiries"][number]): HotelRequest {
  const nights = nightsBetween(inquiry.checkIn, inquiry.checkOut);
  const adults = countLabel(inquiry.occupancy.adults, "adult", "adults");
  const children = inquiry.occupancy.childAges.length;
  const workflow = inquiry.workflowState;
  const status = workflow === "requires_confirmation"
    ? "payment"
    : workflow === "payment_link_sent"
      ? "completed"
    : workflow === "needs_attention"
      ? "attention"
      : workflow === "offer_sent"
        ? "waiting"
        : "new";
  const sendingTimedOut = inquiry.attentionReason === AUTOMATIC_SENDING_TIMEOUT_REASON;
  const statusLabel = requestLabel(status, sendingTimedOut || inquiry.channelStates.email === "failed" || inquiry.channelStates.whatsapp === "failed");
  const nextAction = workflow === "requires_confirmation"
    ? "Review availability"
    : workflow === "needs_attention"
      ? sendingTimedOut ? "Check delivery and channel connections" : "Review rates and request"
      : undefined;
  return {
    id: inquiry.id,
    reservationNumber: inquiry.reservationNumber,
    guestName: inquiry.guestName,
    mealPlan: inquiry.mealPlan,
    checkIn: inquiry.checkIn,
    checkOut: inquiry.checkOut,
    occupancy: inquiry.occupancy,
    locale: inquiry.locale,
    note: inquiry.note,
    receivedVia: inquiry.receivedVia ?? null,
    offerExpiresAt: inquiry.offerExpiresAt,
    offerSentAt: inquiry.offerSentAt,
    acceptedAt: inquiry.acceptedAt,
    paymentLinkSentAt: inquiry.paymentLinkSentAt,
    currentOfferId: inquiry.currentOfferId ?? null,
    offers: inquiry.offers ?? [],
    stayLabel: `${inquiry.checkIn} — ${inquiry.checkOut} · ${countLabel(nights, "night", "nights")}`,
    guestLabel: `${adults}${children ? ` · ${countLabel(children, "child", "children")}` : ""}`,
    roomLabel: inquiry.offerSummary?.roomName ?? "No offer created",
    totalCents: inquiry.offerSummary?.totalCents ?? 0,
    currency: inquiry.offerSummary?.currency ?? "EUR",
    totalLabel: inquiry.offerSummary
      ? new Intl.NumberFormat(uiLocale(), { style: "currency", currency: inquiry.offerSummary.currency }).format(inquiry.offerSummary.totalCents / 100)
      : "—",
    receivedAt: inquiry.createdAt,
    status,
    statusLabel,
    ...(nextAction ? { nextAction } : {}),
    attentionReason: inquiry.attentionReason,
    processingDeadlineAt: inquiry.processingDeadlineAt ?? null,
    email: mapDeliveryDetail(inquiry.channelStates.email, inquiry.channelDetails.email, inquiry.guestEmail),
    whatsapp: mapDeliveryDetail(inquiry.channelStates.whatsapp, inquiry.channelDetails.whatsapp, inquiry.guestPhone),
  };
}

function mapDeliveryDetail(
  state: ApiDeliveryState | null,
  detail: { attemptCount?: number; recipient: string; lastErrorCode: string | null; processedAt: string | null } | null,
  contact: string | null,
) {
  return {
    status: mapDeliveryState(state),
    ...(state ? { state } : {}),
    ...(detail?.attemptCount !== undefined ? { attemptCount: detail.attemptCount } : {}),
    ...(contact || detail?.recipient ? { recipient: contact || detail!.recipient } : {}),
    ...(detail ? { lastErrorCode: detail.lastErrorCode, processedAt: detail.processedAt } : {}),
  };
}

export function authErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return t("Could not complete the action. Please try again.");
  const messages: Record<string, string> = {
    API_NOT_CONFIGURED: error.message,
    NETWORK_ERROR: error.message,
    EMAIL_IN_USE: "An account with this email already exists. Try signing in.",
    INVALID_CREDENTIALS: "Incorrect email or password.",
    VALIDATION_ERROR: "Check the fields and try again.",
    HOTEL_EXISTS: "A hotel profile already exists for this account.",
    HOTEL_NOT_FOUND: "Create your hotel profile first.",
    NO_SESSION: "Your session has ended. Sign in again.",
    UNAUTHORIZED: "Your session has ended. Sign in again.",
    ROOM_NOT_FOUND: "This room was not found or has been deleted.",
    INVALID_ROOM_CAPACITY: "Check capacity: total guests must include all adults and stay within the room limit.",
    RATE_PERIOD_OVERLAP: "This room already has a rate for part of this period.",
    INVALID_RATE_RANGE: "Check the rate period dates.",
    INVALID_RATE_OCCUPANCY: "Included guests cannot exceed this room's capacity.",
    ROOM_CAPACITY_EXCEEDED: "The number of guests exceeds the room capacity.",
    CONFIG_REQUIRED: "This connection is temporarily unavailable. Please try again later.",
    SOCIAL_AUTH_NOT_CONFIGURED: error.message,
    SOCIAL_AUTH_UNAVAILABLE: error.message,
    SOCIAL_AUTH_FAILED: error.message,
    SOCIAL_AUTH_CANCELLED: error.message,
    SOCIAL_TOKEN_INVALID: "The identity provider could not verify this sign-in. Please try again.",
    SOCIAL_EMAIL_UNVERIFIED: "Use an account with a verified email address.",
    SOCIAL_ACCOUNT_CONFLICT: "This email is already linked to a different sign-in method.",
    INVALID_IMAGE: "Upload a valid JPEG or PNG image up to 5 MB.",
  };
  return t(messages[error.code] ?? "Could not complete the action. Please try again.");
}
