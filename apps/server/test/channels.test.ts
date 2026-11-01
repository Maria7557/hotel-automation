import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import type { ProviderFetch } from "../src/providers/http.js";
import { createMemoryRepositories, type MemoryRepositories } from "./helpers/memory-repositories.js";

const baseEnv = {
  AUTH_SECRET: "test-auth-secret-that-is-at-least-32-characters",
  SESSION_TTL_DAYS: 30,
  PUBLIC_BASE_URL: "https://offers.example",
  WAHA_BASE_URL: "https://waha.example",
  WAHA_API_KEY: "platform-waha-secret",
  corsOrigins: ["http://localhost:8081"],
};

const googleEnv = {
  ...baseEnv,
  GOOGLE_CLIENT_ID: "google-client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  GOOGLE_REDIRECT_URI: "https://api.example/v1/connections/google/oauth/callback",
};

describe("message settings and channel connections", () => {
  let app: FastifyInstance;
  let repositories: MemoryRepositories;
  let providerFetch: ProviderFetch;
  let providerFetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    repositories = createMemoryRepositories();
    providerFetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/api/contacts/check-exists")) {
        return new Response(JSON.stringify({
          numberExists: true,
          chatId: "89902624575692@lid",
          pn: "393331234567@c.us",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/sessions/")) {
        return new Response(JSON.stringify({ name: "hotel-main", status: "WORKING", me: { id: "971505554801@c.us" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/api/sendText")) {
        return new Response(JSON.stringify({ id: "waha-message-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error("Unexpected provider URL");
    });
    providerFetch = providerFetchMock as ProviderFetch;
    app = await createApp({ env: baseEnv, repositories, providerFetch, logger: false });
  });

  afterEach(async () => app.close());

  it("requires authentication and an onboarded hotel", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/hotel/message-settings" })).statusCode).toBe(401);
    const token = await register(app, "owner@example.com");
    const missing = await app.inject({
      method: "GET",
      url: "/v1/connections",
      headers: auth(token),
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("HOTEL_NOT_FOUND");
  });

  it("reads defaults, replaces settings and rejects unknown variables", async () => {
    const owner = await onboard(app, "owner@example.com", "Casa Blu");
    const defaults = await app.inject({
      method: "GET",
      url: "/v1/hotel/message-settings",
      headers: auth(owner.token),
    });
    expect(defaults.statusCode).toBe(200);
    expect(defaults.json().data.settings).toMatchObject({
      hotelId: owner.hotelId,
      emailSubjectTemplate: "Your offer from {{hotel_name}}",
      allowedVariables: expect.arrayContaining(["guest_name", "offer_url"]),
    });

    const updated = await app.inject({
      method: "PUT",
      url: "/v1/hotel/message-settings",
      headers: auth(owner.token),
      payload: {
        emailSubjectTemplate: "Offerta {{hotel_name}} per {{guest_name}}",
        emailBodyTemplate: "Ciao {{guest_name}}\nTotale {{total}}\n{{offer_url}}",
        whatsappBodyTemplate: "{{hotel_name}}: {{offer_url}}",
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.settings.emailBodyTemplate).toContain("{{total}}");

    const invalid = await app.inject({
      method: "PUT",
      url: "/v1/hotel/message-settings",
      headers: auth(owner.token),
      payload: {
        emailSubjectTemplate: "{{password}}",
        emailBodyTemplate: "Body",
        whatsappBodyTemplate: "Message",
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(invalid.json())).toContain("Unknown template variable");
  });

  it("renders safe preview HTML and never appends PII to the offer URL", async () => {
    const owner = await onboard(app, "owner@example.com", "Casa <Blu>");
    await app.inject({
      method: "PUT",
      url: "/v1/hotel/message-settings",
      headers: auth(owner.token),
      payload: {
        emailSubjectTemplate: "Proposta {{hotel_name}} per {{guest_name}}",
        emailBodyTemplate: "<script>alert(1)</script> Ciao {{guest_name}} {{offer_url}}",
        whatsappBodyTemplate: "Ciao {{guest_name}} {{offer_url}}",
      },
    });
    const preview = await app.inject({
      method: "POST",
      url: "/v1/hotel/message-settings/preview",
      headers: auth(owner.token),
      payload: {
        channel: "email",
        sample: {
          guestName: "Anna <img src=x onerror=alert(1)>",
          checkIn: "2027-01-01",
          checkOut: "2027-01-02",
          guestCount: 1,
          totalCents: 12_345,
        },
      },
    });
    expect(preview.statusCode).toBe(200);
    const rendered = preview.json().data.preview;
    expect(rendered.text).toContain("https://offers.example/proposal/test/");
    expect(rendered.offer).toMatchObject({ hotelName: "Casa <Blu>", checkIn: "2027-01-01", checkOut: "2027-01-02" });
    expect(rendered.html).not.toContain("<script>alert");
    expect(rendered.html).not.toContain("<img src=x");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).not.toContain("Anna%20");
  });

  it("builds a working test offer from the hotel's real rooms and rates", async () => {
    const owner = await onboard(app, "preview@example.com", "Casa Blu");
    const room = await app.inject({
      method: "POST", url: "/v1/rooms", headers: auth(owner.token), payload: {
        name: "Camera Deluxe", description: "Camera matrimoniale", maxAdults: 2, maxChildren: 1, maxGuests: 3,
        beds: [{ type: "king", count: 1 }], amenities: ["wifi"], photoUrls: ["https://images.example/room.jpg"],
      },
    });
    const roomId = room.json().data.room.id as string;
    await app.inject({
      method: "POST", url: `/v1/rooms/${roomId}/rates`, headers: auth(owner.token), payload: {
        planCode: "breakfast", planName: "Breakfast included", mealPlan: "breakfast",
        start: "2026-11-01", endInclusive: "2026-12-31", nightlyBaseCents: 10_000,
        includedAdults: 2, includedChildren: 0, extraAdultCents: 3_000, extraChildCents: 1_500,
        breakfastAdultCents: 1_200, breakfastChildCents: 600, maxChildAge: 12, minNights: 1,
      },
    });
    await app.inject({
      method: "PUT", url: "/v1/hotel/message-settings", headers: auth(owner.token), payload: {
        emailSubjectTemplate: "Test {{hotel_name}}", emailBodyTemplate: "Test body without a link",
        whatsappBodyTemplate: "WhatsApp body without a link",
      },
    });

    const preview = await app.inject({
      method: "POST", url: "/v1/hotel/message-settings/preview", headers: auth(owner.token), payload: { channel: "email" },
    });
    expect(preview.statusCode).toBe(200);
    const rendered = preview.json().data.preview;
    expect(rendered.offer).toMatchObject({
      hotelName: "Casa Blu", checkIn: "2026-11-01", checkOut: "2026-11-02", roomNames: ["Camera Deluxe"],
    });
    expect(rendered.text).toContain(rendered.offer.url);
    const offerUrl = new URL(rendered.offer.url);
    const page = await app.inject({ method: "GET", url: `${offerUrl.pathname}${offerUrl.search}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Casa Blu");
    expect(page.body).toContain("Camera Deluxe");
    expect(page.body).toContain("https://images.example/room.jpg");
    expect(repositories.automation.inquiries.size).toBe(0);
  });

  it("creates a transparent fake Delivery through the preview path without claiming sent", async () => {
    const owner = await onboard(app, "owner@example.com", "Casa Blu");
    const response = await app.inject({
      method: "POST",
      url: "/v1/hotel/message-settings/test-send",
      headers: auth(owner.token),
      payload: { channel: "email", recipient: "owner@example.com" },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().data).toMatchObject({
      provider: "fake",
      accepted: false,
      delivery: {
        channel: "email",
        state: "unknown",
        recipient: "owner@example.com",
        lastErrorCode: "FAKE_PROVIDER",
      },
      rendered: { channel: "email" },
    });
    const [delivery] = repositories.automation.deliveries.values();
    expect(delivery).toMatchObject({
      hotelId: owner.hotelId,
      kind: "test",
      state: "unknown",
      providerMessageId: null,
      lastErrorMessage: "No external provider call was made.",
    });
    expect(delivery?.payload.rendered).toEqual(response.json().data.rendered);
    expect(JSON.stringify(delivery)).not.toContain('"delivered"');
    expect(JSON.stringify(delivery)).not.toContain('"provider_accepted"');
  });

  it("isolates settings, connections and test deliveries by hotel", async () => {
    const owner = await onboard(app, "owner@example.com", "Owner Hotel");
    const other = await onboard(app, "other@example.com", "Other Hotel");
    await app.inject({
      method: "PUT",
      url: "/v1/hotel/message-settings",
      headers: auth(owner.token),
      payload: {
        emailSubjectTemplate: "OWNER {{hotel_name}}",
        emailBodyTemplate: "Owner body",
        whatsappBodyTemplate: "Owner WA",
      },
    });
    const otherSettings = await app.inject({
      method: "GET",
      url: "/v1/hotel/message-settings",
      headers: auth(other.token),
    });
    expect(otherSettings.json().data.settings.emailSubjectTemplate).not.toContain("OWNER");

    await app.inject({
      method: "POST",
      url: "/v1/connections/waha/connect",
      headers: auth(owner.token),
    });
    const otherConnections = await app.inject({
      method: "GET",
      url: "/v1/connections",
      headers: auth(other.token),
    });
    expect(otherConnections.json().data.connections.find(({ kind }: { kind: string }) => kind === "waha"))
      .toMatchObject({ configured: false, state: "disconnected" });
  });

  it("keeps platform WAHA credentials off the public API", async () => {
    const owner = await onboard(app, "owner@example.com", "Casa Blu");
    const configured = await app.inject({
      method: "POST",
      url: "/v1/connections/waha/connect",
      headers: auth(owner.token),
    });
    expect(configured.statusCode).toBe(200);
    expect(configured.json().data.connection).toMatchObject({
      kind: "waha",
      configured: true,
      available: true,
      state: "connected",
      lastErrorCode: null,
      baseUrl: "https://waha.example",
      phoneNumber: "971505554801",
    });
    expect(configured.json().data.connection.sessionName).toMatch(/^hotel-/);
    expect(configured.body).not.toContain(baseEnv.WAHA_API_KEY);
    const stored = repositories.channels.connections.get(`${owner.hotelId}:waha`);
    expect(stored?.encryptedCredentials).toMatch(/^v1\./);
    expect(stored?.encryptedCredentials).not.toContain(baseEnv.WAHA_API_KEY);

    const status = await app.inject({
      method: "GET",
      url: "/v1/connections/waha",
      headers: auth(owner.token),
    });
    expect(status.body).not.toContain(baseEnv.WAHA_API_KEY);
    expect(status.json().data.connection.configured).toBe(true);
  });

  it("checks a WAHA session and performs a real test send only after it is connected", async () => {
    const owner = await onboard(app, "owner@example.com", "Casa Blu");
    await app.inject({
      method: "POST",
      url: "/v1/connections/waha/connect",
      headers: auth(owner.token),
    });

    const checked = await app.inject({
      method: "POST",
      url: "/v1/connections/waha/check",
      headers: auth(owner.token),
    });
    expect(checked.statusCode).toBe(200);
    expect(checked.json().data.connection).toMatchObject({ state: "connected", lastErrorCode: null });

    const sent = await app.inject({
      method: "POST",
      url: "/v1/hotel/message-settings/test-send",
      headers: auth(owner.token),
      payload: { channel: "whatsapp", recipient: "+393331234567" },
    });
    expect(sent.statusCode).toBe(202);
    expect(sent.json().data).toMatchObject({
      provider: "waha",
      accepted: true,
      delivery: { state: "provider_accepted", lastErrorCode: null },
    });
    const sendCall = providerFetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/sendText"));
    expect(sendCall?.[1]?.headers).toMatchObject({ "X-Api-Key": baseEnv.WAHA_API_KEY });
    expect(JSON.parse(String(sendCall?.[1]?.body))).toMatchObject({
      session: expect.stringMatching(/^hotel-/),
      chatId: "89902624575692@lid",
    });
    expect(JSON.stringify(sent.json())).not.toContain(baseEnv.WAHA_API_KEY);
  });

  it("blocks a WhatsApp test sent to the connected sender number", async () => {
    const owner = await onboard(app, "self-send@example.com", "Casa Blu");
    await app.inject({
      method: "POST",
      url: "/v1/connections/waha/connect",
      headers: auth(owner.token),
    });

    const sent = await app.inject({
      method: "POST",
      url: "/v1/hotel/message-settings/test-send",
      headers: auth(owner.token),
      payload: { channel: "whatsapp", recipient: "+971505554801" },
    });

    expect(sent.statusCode).toBe(202);
    expect(sent.json().data).toMatchObject({
      provider: "waha",
      accepted: false,
      delivery: { state: "failed", lastErrorCode: "WAHA_RECIPIENT_IS_SENDER" },
    });
    expect(providerFetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/sendText"))).toBe(false);
    expect(repositories.channels.connections.get(`${owner.hotelId}:waha`)).toMatchObject({
      state: "connected",
      metadata: { phoneNumber: "971505554801" },
      lastErrorCode: null,
    });
  });

  it("refreshes WhatsApp status on page load and can disconnect the linked phone", async () => {
    const owner = await onboard(app, "refresh@example.com", "Casa Verde");
    await app.inject({
      method: "POST",
      url: "/v1/connections/waha/connect",
      headers: auth(owner.token),
    });
    await repositories.channels.updateConnectionForHotel({
      hotelId: owner.hotelId,
      kind: "waha",
      state: "connecting",
      lastCheckedAt: new Date(),
      lastErrorCode: null,
    });

    const refreshed = await app.inject({
      method: "GET",
      url: "/v1/connections",
      headers: auth(owner.token),
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().data.connections.find(({ kind }: { kind: string }) => kind === "waha"))
      .toMatchObject({ configured: true, state: "connected" });

    const disconnected = await app.inject({
      method: "DELETE",
      url: "/v1/connections/waha",
      headers: auth(owner.token),
    });
    expect(disconnected.statusCode).toBe(200);
    expect(disconnected.json().data.connection).toMatchObject({
      configured: false,
      available: true,
      state: "disconnected",
    });
    expect(repositories.channels.connections.get(`${owner.hotelId}:waha`)?.encryptedCredentials).toBeNull();
    const logoutCall = providerFetchMock.mock.calls.find(([url, init]) =>
      String(url).includes("/logout") && init?.method === "POST");
    expect(logoutCall).toBeTruthy();
  });

  it("lets a hotel connect WhatsApp without entering platform credentials", async () => {
    await app.close();
    repositories = createMemoryRepositories();
    providerFetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/sessions/hotel-") && init?.method === "GET") {
        return new Response(JSON.stringify({ message: "not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/api/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ status: "SCAN_QR_CODE", me: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/auth/qr")) {
        return new Response(JSON.stringify({ mimetype: "image/png", data: "cXItYnl0ZXM=" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected provider URL: ${url}`);
    });
    providerFetch = providerFetchMock as ProviderFetch;
    app = await createApp({
      env: {
        ...baseEnv,
        WAHA_BASE_URL: "https://waha.platform.example",
        WAHA_API_KEY: "platform-waha-secret",
      },
      repositories,
      providerFetch,
      logger: false,
    });
    const owner = await onboard(app, "owner@example.com", "Casa Blu");

    const response = await app.inject({
      method: "POST",
      url: "/v1/connections/waha/connect",
      headers: auth(owner.token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      connection: { kind: "waha", configured: true, available: true, state: "connecting" },
      qrCode: "data:image/png;base64,cXItYnl0ZXM=",
    });
    expect(response.body).not.toContain("platform-waha-secret");
    const createCall = providerFetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/sessions"));
    expect(createCall?.[1]?.headers).toMatchObject({ "X-Api-Key": "platform-waha-secret" });
  });

  it("waits for a starting WhatsApp session and returns its QR code", async () => {
    await app.close();
    repositories = createMemoryRepositories();
    let statusChecks = 0;
    providerFetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/sessions/hotel-") && init?.method === "GET") {
        statusChecks += 1;
        return new Response(JSON.stringify({
          status: statusChecks === 1 ? "STARTING" : "SCAN_QR_CODE",
          me: null,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/auth/qr")) {
        return new Response(JSON.stringify({ mimetype: "image/png", data: "cXItYnl0ZXM=" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected provider URL: ${url}`);
    });
    app = await createApp({ env: baseEnv, repositories, providerFetch: providerFetchMock as ProviderFetch, logger: false });
    const owner = await onboard(app, "starting@example.com", "Casa QR");

    const response = await app.inject({
      method: "POST",
      url: "/v1/connections/waha/connect",
      headers: auth(owner.token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      connection: { state: "connecting" },
      qrCode: "data:image/png;base64,cXItYnl0ZXM=",
    });
    expect(statusChecks).toBe(2);
  });

  it("returns CONFIG_REQUIRED when Google OAuth environment credentials are absent", async () => {
    const owner = await onboard(app, "owner@example.com", "Casa Blu");
    const response = await app.inject({
      method: "GET",
      url: "/v1/connections/google/oauth/start",
      headers: auth(owner.token),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("CONFIG_REQUIRED");
  });
});

describe("Google OAuth state architecture", () => {
  let app: FastifyInstance;
  let repositories: MemoryRepositories;
  let providerFetch: ProviderFetch;
  let providerFetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    repositories = createMemoryRepositories();
    providerFetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({
          access_token: "google-access-token",
          refresh_token: "google-refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "https://www.googleapis.com/auth/gmail.send",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("gmail.googleapis.com")) {
        return new Response(JSON.stringify({ id: "gmail-message-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error("Unexpected provider URL");
    });
    providerFetch = providerFetchMock as ProviderFetch;
    app = await createApp({ env: googleEnv, repositories, providerFetch, logger: false });
  });

  afterEach(async () => app.close());

  it("exchanges the code, stores encrypted tokens, and consumes signed state once", async () => {
    const owner = await onboard(app, "owner@example.com", "Casa Blu");
    const start = await app.inject({
      method: "GET",
      url: "/v1/connections/google/oauth/start",
      headers: auth(owner.token),
    });
    expect(start.statusCode).toBe(200);
    const authorizationUrl = new URL(start.json().data.authorizationUrl);
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(authorizationUrl.searchParams.get("client_id")).toBe(googleEnv.GOOGLE_CLIENT_ID);
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(googleEnv.GOOGLE_REDIRECT_URI);
    expect(authorizationUrl.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.send");
    expect(start.body).not.toContain(googleEnv.GOOGLE_CLIENT_SECRET);
    const state = authorizationUrl.searchParams.get("state");
    expect(state).toBeTruthy();

    const callback = await app.inject({
      method: "GET",
      url: `/v1/connections/google/oauth/callback?state=${encodeURIComponent(state!)}&code=one-time-code`,
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.headers["content-type"]).toContain("text/html");
    expect(callback.body).toContain("Mail connected");
    expect(callback.body).toContain("Back to Hotel");
    const stored = repositories.channels.connections.get(`${owner.hotelId}:google`);
    expect(stored?.metadata.oauthNonceHash).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain("one-time-code");
    expect(stored?.encryptedCredentials).toMatch(/^v1\./);
    expect(callback.body).not.toContain("google-access-token");
    expect(callback.body).not.toContain("google-refresh-token");
    const tokenCall = providerFetchMock.mock.calls[0];
    expect(String(tokenCall?.[0])).toBe("https://oauth2.googleapis.com/token");
    expect(String(tokenCall?.[1]?.body)).toContain("grant_type=authorization_code");
    expect(String(tokenCall?.[1]?.body)).toContain("code=one-time-code");

    const replay = await app.inject({
      method: "GET",
      url: `/v1/connections/google/oauth/callback?state=${encodeURIComponent(state!)}&code=replayed-code`,
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.headers["content-type"]).toContain("text/html");
    expect(replay.body).toContain("Connection unsuccessful");
  });

  it("keeps the selected sender address visible and can disconnect mail", async () => {
    const owner = await onboard(app, "owner@example.com", "Casa Blu");
    const start = await app.inject({
      method: "POST",
      url: "/v1/connections/mail/google/oauth/start",
      headers: auth(owner.token),
      payload: { email: "booking@casablu.example" },
    });
    expect(start.statusCode).toBe(200);
    const authorizationUrl = new URL(start.json().data.authorizationUrl);
    const state = authorizationUrl.searchParams.get("state");
    const callback = await app.inject({
      method: "GET",
      url: `/v1/connections/google/oauth/callback?state=${encodeURIComponent(state!)}&code=one-time-code`,
    });
    expect(callback.statusCode).toBe(200);

    const connected = await app.inject({ method: "GET", url: "/v1/connections", headers: auth(owner.token) });
    expect(connected.json().data.connections.find(({ kind }: { kind: string }) => kind === "mail"))
      .toMatchObject({ configured: true, state: "connected", senderEmail: "booking@casablu.example" });

    const disconnected = await app.inject({ method: "DELETE", url: "/v1/connections/mail", headers: auth(owner.token) });
    expect(disconnected.statusCode).toBe(200);
    expect(disconnected.json().data.connection).toMatchObject({ configured: false, state: "disconnected", senderEmail: null });
    expect(repositories.channels.connections.get(`${owner.hotelId}:google`)?.encryptedCredentials).toBeNull();
  });

  it("uses Gmail for test-send after a successful OAuth connection", async () => {
    const owner = await onboard(app, "owner@example.com", "Casa Blu");
    const start = await app.inject({
      method: "GET",
      url: "/v1/connections/google/oauth/start",
      headers: auth(owner.token),
    });
    const state = new URL(start.json().data.authorizationUrl).searchParams.get("state")!;
    await app.inject({
      method: "GET",
      url: `/v1/connections/google/oauth/callback?state=${encodeURIComponent(state)}&code=code`,
    });
    const sent = await app.inject({
      method: "POST",
      url: "/v1/hotel/message-settings/test-send",
      headers: auth(owner.token),
      payload: { channel: "email", recipient: "owner@example.com" },
    });
    expect(sent.statusCode).toBe(202);
    expect(sent.json().data).toMatchObject({
      provider: "gmail",
      accepted: true,
      delivery: { state: "provider_accepted", lastErrorCode: null },
    });
    const gmailCall = providerFetchMock.mock.calls.find(([url]) => String(url).includes("gmail.googleapis.com"));
    expect(gmailCall?.[1]?.headers).toMatchObject({ Authorization: "Bearer google-access-token" });
    const raw = JSON.parse(String(gmailCall?.[1]?.body)).raw as string;
    expect(Buffer.from(raw, "base64url").toString("utf8")).toContain("To: owner@example.com\r\n");
  });

  it("rejects a tampered signed state", async () => {
    const owner = await onboard(app, "owner@example.com", "Casa Blu");
    const start = await app.inject({
      method: "GET",
      url: "/v1/connections/google/oauth/start",
      headers: auth(owner.token),
    });
    const url = new URL(start.json().data.authorizationUrl);
    const state = url.searchParams.get("state")!;
    const response = await app.inject({
      method: "GET",
      url: `/v1/connections/google/oauth/callback?state=${encodeURIComponent(`${state}x`)}&code=code`,
    });
    expect(response.statusCode).toBe(409);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Connection unsuccessful");
  });

  it("consumes OAuth state and marks the connection attention when token exchange fails", async () => {
    providerFetchMock.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ error: "invalid_grant", secret: "must-not-leak" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const owner = await onboard(app, "failure@example.com", "Casa Blu");
    const start = await app.inject({
      method: "GET",
      url: "/v1/connections/google/oauth/start",
      headers: auth(owner.token),
    });
    const state = new URL(start.json().data.authorizationUrl).searchParams.get("state")!;
    const failed = await app.inject({
      method: "GET",
      url: `/v1/connections/google/oauth/callback?state=${encodeURIComponent(state)}&code=bad-code`,
    });
    expect(failed.statusCode).toBe(502);
    expect(failed.headers["content-type"]).toContain("text/html");
    expect(failed.body).toContain("Connection unsuccessful");
    expect(failed.body).not.toContain("must-not-leak");
    expect(repositories.channels.connections.get(`${owner.hotelId}:google`)).toMatchObject({
      state: "attention",
      lastErrorCode: "GOOGLE_TOKEN_HTTP_400",
    });
    const replay = await app.inject({
      method: "GET",
      url: `/v1/connections/google/oauth/callback?state=${encodeURIComponent(state)}&code=other-code`,
    });
    expect(replay.statusCode).toBe(409);
  });
});

async function register(app: FastifyInstance, email: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: "a-strong-password", displayName: "Owner" },
  });
  return response.json().data.accessToken as string;
}

async function onboard(app: FastifyInstance, email: string, name: string) {
  const token = await register(app, email);
  const response = await app.inject({
    method: "POST",
    url: "/v1/hotel",
    headers: auth(token),
    payload: { name, city: "Firenze" },
  });
  return { token, hotelId: response.json().data.hotel.id as string };
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
