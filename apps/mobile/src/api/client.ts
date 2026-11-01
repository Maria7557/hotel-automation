import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { mockDashboard } from "./mock";
import type {
  AuthSession,
  DashboardSnapshot,
  HotelProfile,
  HotelProfileInput,
  HotelIntakeSettings,
  ConnectionStatus,
  MessageChannel,
  MessagePreview,
  MessageSettings,
  MessageSettingsInput,
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

type ApiDeliveryState =
  | "scheduled"
  | "processing"
  | "provider_accepted"
  | "delivered"
  | "failed"
  | "unknown"
  | "cancelled";

type ApiDashboard = {
  counts: { total: number; new: number; offerSent: number; requiresConfirmation: number; requiresConfirmationTotalCents: number; needsAttention: number };
  inquiries: Array<{
    id: string;
    guestName: string;
    checkIn: string;
    checkOut: string;
    occupancy: { adults: number; childAges: number[] };
    offerSummary: { roomName: string; totalCents: number; currency: string } | null;
    channelStates: { email: ApiDeliveryState | null; whatsapp: ApiDeliveryState | null };
    channelDetails: {
      email: { state: ApiDeliveryState; recipient: string; lastErrorCode: string | null; processedAt: string | null } | null;
      whatsapp: { state: ApiDeliveryState; recipient: string; lastErrorCode: string | null; processedAt: string | null } | null;
    };
    workflowState: "new" | "offer_sent" | "requires_confirmation" | "needs_attention";
    attentionReason: string | null;
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
): Promise<T> {
  const baseUrl = requireApiUrl();
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
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
    if (response.status === 401 && token) await clearToken();
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

export const apiClient = {
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
    input: { planCode: string; checkIn: string; checkOut: string; adults: number; childAges: number[] },
  ): Promise<RatePreview> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { preview: RatePreview } }>(
      `/v1/rooms/${encodeURIComponent(roomId)}/rates/preview`,
      {
        method: "POST",
        body: JSON.stringify({
          planCode: input.planCode,
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

  async previewMessage(channel: MessageChannel): Promise<MessagePreview> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { preview: MessagePreview } }>(
      "/v1/hotel/message-settings/preview",
      { method: "POST", body: JSON.stringify({ channel }) },
      token,
    );
    return response.data.preview;
  },

  async testMessage(channel: MessageChannel, recipient: string): Promise<TestSendResult> {
    const token = await requireToken();
    const response = await apiRequest<{ data: TestSendResult }>(
      "/v1/hotel/message-settings/test-send",
      { method: "POST", body: JSON.stringify({ channel, recipient }) },
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

  async startGoogleOAuth(): Promise<{ authorizationUrl: string; expiresAt: string }> {
    const token = await requireToken();
    const response = await apiRequest<{ data: { authorizationUrl: string; expiresAt: string } }>(
      "/v1/connections/google/oauth/start",
      {},
      token,
    );
    return response.data;
  },

  async getDashboard(options: { demo?: boolean } = {}): Promise<DashboardSnapshot> {
    if (options.demo) {
      await new Promise((resolve) => setTimeout(resolve, 240));
      return mockDashboard;
    }
    const token = await requireToken();
    const response = await apiRequest<{ data: ApiDashboard }>("/v1/dashboard", {}, token);
    return mapDashboard(response.data);
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
    totalCount: input.counts.total,
    newCount: input.counts.new,
    waitingCount: input.counts.offerSent,
    paymentPendingCount: input.counts.requiresConfirmation,
    paymentPendingTotalCents: input.counts.requiresConfirmationTotalCents,
    attentionCount: input.counts.needsAttention,
    requests: input.inquiries.map((inquiry) => {
      const nights = nightsBetween(inquiry.checkIn, inquiry.checkOut);
      const adults = countLabel(inquiry.occupancy.adults, "adult", "adults");
      const children = inquiry.occupancy.childAges.length;
      const workflow = inquiry.workflowState;
      const status = workflow === "requires_confirmation"
        ? "payment"
        : workflow === "needs_attention"
          ? "attention"
          : workflow === "offer_sent"
            ? "waiting"
            : "new";
      const statusLabel = workflow === "requires_confirmation"
        ? "Payment pending"
        : workflow === "needs_attention"
          ? "Needs attention"
          : workflow === "offer_sent"
            ? "Waiting for guest"
            : "New request";
      const nextAction = workflow === "requires_confirmation"
        ? "Send payment link"
        : workflow === "needs_attention"
          ? "Review rates and request"
          : undefined;
      const received = new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(inquiry.createdAt));
      return {
        id: inquiry.id,
        guestName: inquiry.guestName,
        stayLabel: `${inquiry.checkIn} — ${inquiry.checkOut} · ${countLabel(nights, "night", "nights")}`,
        guestLabel: `${adults}${children ? ` · ${countLabel(children, "child", "children")}` : ""}`,
        roomLabel: inquiry.offerSummary?.roomName ?? "No offer created",
        totalCents: inquiry.offerSummary?.totalCents ?? 0,
        currency: inquiry.offerSummary?.currency ?? "EUR",
        totalLabel: inquiry.offerSummary
          ? new Intl.NumberFormat("en-GB", { style: "currency", currency: inquiry.offerSummary.currency }).format(inquiry.offerSummary.totalCents / 100)
          : "—",
        receivedAt: received,
        status,
        statusLabel,
        ...(nextAction ? { nextAction } : {}),
        attentionReason: inquiry.attentionReason,
        email: mapDeliveryDetail(inquiry.channelStates.email, inquiry.channelDetails.email),
        whatsapp: mapDeliveryDetail(inquiry.channelStates.whatsapp, inquiry.channelDetails.whatsapp),
      };
    }),
  };
}

function mapDeliveryDetail(
  state: ApiDeliveryState | null,
  detail: { recipient: string; lastErrorCode: string | null; processedAt: string | null } | null,
) {
  return {
    status: mapDeliveryState(state),
    ...(detail?.recipient ? { recipient: detail.recipient } : {}),
    ...(detail ? { lastErrorCode: detail.lastErrorCode, processedAt: detail.processedAt } : {}),
  };
}

export function authErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Could not complete the action. Please try again.";
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
  };
  return messages[error.code] ?? error.message;
}
