import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { sealPrivateValue } from "../src/lib/public-token.js";
import { GoogleProvider } from "../src/providers/google.js";
import type { ProviderFetch } from "../src/providers/http.js";
import { WahaProvider } from "../src/providers/waha.js";
import type {
  ConnectionKind,
  DeliveryRecord,
  HotelProfile,
  OfferRecord,
} from "../src/repositories/types.js";
import { DeliveryWorker } from "../src/services/delivery-worker.js";
import { createMemoryRepositories, type MemoryRepositories } from "./helpers/memory-repositories.js";

const secret = "delivery-worker-secret-that-is-at-least-32-characters";
const googleConfig = {
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REDIRECT_URI: "https://api.example/oauth/callback",
};
const now = new Date("2026-11-01T10:00:00.000Z");

describe("delivery worker repository claim", () => {
  it("claims an offer exactly once under concurrency and ignores kind=test", async () => {
    const repositories = createMemoryRepositories();
    const { delivery } = seedDelivery(repositories, "whatsapp");
    repositories.automation.deliveries.set("test-delivery", {
      ...delivery,
      id: "test-delivery",
      kind: "test",
      idempotencyKey: "test-delivery",
    });

    const [first, second] = await Promise.all([
      repositories.deliveryWorker.claimNextOfferDelivery(now),
      repositories.deliveryWorker.claimNextOfferDelivery(now),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(first?.delivery.id ?? second?.delivery.id).toBe(delivery.id);
    expect(repositories.automation.deliveries.get(delivery.id)?.state).toBe("processing");
    expect(repositories.automation.deliveries.get("test-delivery")?.state).toBe("scheduled");
  });
});

describe("DeliveryWorker", () => {
  it("leaves a delivery scheduled without consuming an attempt when the connection is missing", async () => {
    const repositories = createMemoryRepositories();
    const { delivery } = seedDelivery(repositories, "whatsapp");
    const fetchMock = vi.fn();
    const worker = createWorker(repositories, fetchMock);

    expect(await worker.processNext(now)).toBe(true);
    expect(repositories.automation.deliveries.get(delivery.id)).toMatchObject({
      state: "scheduled",
      attemptCount: 0,
      nextAttemptAt: new Date("2026-11-01T10:05:00.000Z"),
      lastErrorCode: "WHATSAPP_CONNECTION_NOT_READY",
      processedAt: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders custom WhatsApp settings from the immutable snapshot and records provider acceptance", async () => {
    const repositories = createMemoryRepositories();
    const { delivery, hotel } = seedDelivery(repositories, "whatsapp");
    connectWaha(repositories, hotel.id);
    repositories.channels.settings.set(hotel.id, {
      hotelId: hotel.id,
      emailSubjectTemplate: "{{hotel_name}}",
      emailBodyTemplate: "{{offer_url}}",
      whatsappBodyTemplate: "Ciao {{guest_name}} — {{total}} — {{offer_url}}",
      createdAt: now,
      updatedAt: now,
    });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "waha-message-1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    const worker = createWorker(repositories, fetchMock);

    await worker.processNext(now);
    expect(repositories.automation.deliveries.get(delivery.id)).toMatchObject({
      state: "provider_accepted",
      attemptCount: 1,
      providerMessageId: "waha-message-1",
      lastErrorCode: null,
      processedAt: now,
    });
    const request = (fetchMock.mock.calls as unknown as Array<[string | URL, RequestInit?]>)[0];
    const body = JSON.parse(String(request?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      session: "hotel-main",
      chatId: "393331234567@c.us",
    });
    expect(body.text).toContain("Ciao Anna");
    expect(body.text).toContain("220,00");
    expect(body.text).toContain("https://offers.example/proposal/opaque-token");
    expect(body.text).not.toContain("v1.");
  });

  it("renders the email through @hotel/templates and records the Gmail id", async () => {
    const repositories = createMemoryRepositories();
    const { delivery, hotel } = seedDelivery(repositories, "email");
    connectGoogle(repositories, hotel.id);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "gmail-message-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const worker = createWorker(repositories, fetchMock);

    await worker.processNext(now);
    expect(repositories.automation.deliveries.get(delivery.id)).toMatchObject({
      state: "provider_accepted",
      attemptCount: 1,
      providerMessageId: "gmail-message-1",
    });
    const request = (fetchMock.mock.calls as unknown as Array<[string | URL, RequestInit?]>)[0];
    const requestBody = JSON.parse(String(request?.[1]?.body)) as { raw: string };
    const mime = Buffer.from(requestBody.raw, "base64url").toString("utf8");
    expect(mime).toContain("To: anna@example.com");
    expect(mime).toContain("https://offers.example/proposal/opaque-token");
    expect(mime).toContain("Hotel Sole");
  });

  it("retries 429/5xx with exponential backoff and fails at max attempts", async () => {
    const repositories = createMemoryRepositories();
    const { delivery, hotel } = seedDelivery(repositories, "whatsapp");
    connectWaha(repositories, hotel.id);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: "busy" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    );
    const worker = createWorker(repositories, fetchMock, 2);

    await worker.processNext(now);
    expect(repositories.automation.deliveries.get(delivery.id)).toMatchObject({
      state: "scheduled",
      attemptCount: 1,
      nextAttemptAt: new Date("2026-11-01T10:01:00.000Z"),
      lastErrorCode: "WAHA_SEND_HTTP_429",
    });
    await worker.processNext(new Date("2026-11-01T10:01:00.000Z"));
    expect(repositories.automation.deliveries.get(delivery.id)).toMatchObject({
      state: "failed",
      attemptCount: 2,
      lastErrorCode: "MAX_ATTEMPTS_WAHA_SEND_HTTP_429",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails a permanent provider 4xx without retry", async () => {
    const repositories = createMemoryRepositories();
    const { delivery, hotel } = seedDelivery(repositories, "whatsapp");
    connectWaha(repositories, hotel.id);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: "bad request" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    await createWorker(repositories, fetchMock).processNext(now);
    expect(repositories.automation.deliveries.get(delivery.id)).toMatchObject({
      state: "failed",
      attemptCount: 1,
      lastErrorCode: "WAHA_SEND_HTTP_400",
    });
  });

  it("retries an explicit timeout but quarantines an ambiguous network outcome", async () => {
    const timeoutRepositories = createMemoryRepositories();
    const timeoutSeed = seedDelivery(timeoutRepositories, "whatsapp");
    connectWaha(timeoutRepositories, timeoutSeed.hotel.id);
    const timeout = new Error("timeout");
    timeout.name = "TimeoutError";
    const timeoutFetch = vi.fn(async () => Promise.reject(timeout));
    await createWorker(timeoutRepositories, timeoutFetch).processNext(now);
    expect(timeoutRepositories.automation.deliveries.get(timeoutSeed.delivery.id)).toMatchObject({
      state: "scheduled",
      attemptCount: 1,
      lastErrorCode: "WAHA_SEND_TIMEOUT",
      nextAttemptAt: new Date("2026-11-01T10:01:00.000Z"),
    });

    const ambiguousRepositories = createMemoryRepositories();
    const ambiguousSeed = seedDelivery(ambiguousRepositories, "whatsapp");
    connectWaha(ambiguousRepositories, ambiguousSeed.hotel.id);
    const networkFetch = vi.fn(async () => Promise.reject(new Error("socket closed")));
    await createWorker(ambiguousRepositories, networkFetch).processNext(now);
    expect(ambiguousRepositories.automation.deliveries.get(ambiguousSeed.delivery.id)).toMatchObject({
      state: "unknown",
      attemptCount: 1,
      lastErrorCode: "WAHA_SEND_NETWORK_ERROR",
      processedAt: now,
    });
    expect(await createWorker(ambiguousRepositories, networkFetch).processNext(now)).toBe(false);
    expect(networkFetch).toHaveBeenCalledTimes(1);
  });

  it("does not send email when Google runtime config is absent", async () => {
    const repositories = createMemoryRepositories();
    const { delivery, hotel } = seedDelivery(repositories, "email");
    connectGoogle(repositories, hotel.id);
    const fetchMock = vi.fn();
    const worker = new DeliveryWorker(
      repositories.deliveryWorker,
      repositories.channels,
      secret,
      {},
      new GoogleProvider(fetchMock as ProviderFetch),
      new WahaProvider(fetchMock as ProviderFetch),
    );
    await worker.processNext(now);
    expect(repositories.automation.deliveries.get(delivery.id)).toMatchObject({
      state: "scheduled",
      attemptCount: 0,
      lastErrorCode: "GOOGLE_CONFIG_REQUIRED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function createWorker(
  repositories: MemoryRepositories,
  fetchMock: ReturnType<typeof vi.fn>,
  maxAttempts = 5,
) {
  const providerFetch = fetchMock as ProviderFetch;
  return new DeliveryWorker(
    repositories.deliveryWorker,
    repositories.channels,
    secret,
    googleConfig,
    new GoogleProvider(providerFetch),
    new WahaProvider(providerFetch),
    maxAttempts,
  );
}

function seedDelivery(repositories: MemoryRepositories, channel: "email" | "whatsapp") {
  const hotel = hotelRecord();
  const offer = offerRecord(hotel.id);
  const delivery: DeliveryRecord = {
    id: randomUUID(),
    hotelId: hotel.id,
    inquiryId: offer.inquiryId,
    offerVersionId: offer.id,
    kind: "offer",
    channel,
    state: "scheduled",
    idempotencyKey: `${offer.id}:${channel}`,
    recipient: channel === "email" ? "anna@example.com" : "+393331234567",
    payload: {
      schemaVersion: 1,
      proposalUrlCiphertext: sealPrivateValue(
        "https://offers.example/proposal/opaque-token",
        secret,
      ),
    },
    attemptCount: 0,
    nextAttemptAt: now,
    providerMessageId: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    processedAt: null,
    createdAt: new Date("2026-11-01T09:00:00.000Z"),
    updatedAt: new Date("2026-11-01T09:00:00.000Z"),
  };
  repositories.hotels.hotels.set(hotel.id, hotel);
  repositories.automation.offers.set(offer.id, offer);
  repositories.automation.deliveries.set(delivery.id, delivery);
  return { hotel, offer, delivery };
}

function hotelRecord(): HotelProfile {
  return {
    id: randomUUID(),
    publicKey: randomUUID(),
    allowedOrigins: [],
    name: "Hotel Sole",
    city: "Roma",
    countryCode: "IT",
    locale: "it-IT",
    description: "Hotel in centro",
    currency: "EUR",
    timezone: "Europe/Rome",
    email: "hotel@example.com",
    phone: null,
    website: null,
    logoUrl: null,
    photoUrls: [],
    termsText: null,
    createdAt: now,
    updatedAt: now,
  };
}

function offerRecord(hotelId: string): OfferRecord {
  return {
    id: randomUUID(),
    hotelId,
    inquiryId: randomUUID(),
    version: 1,
    state: "active",
    publicTokenHash: "a".repeat(64),
    snapshot: {
      schemaVersion: 1,
      inquiryId: "inquiry-1",
      hotelSnapshot: {
        id: hotelId,
        name: "Hotel Sole",
        description: "Hotel in centro",
        currency: "EUR",
        locale: "it-IT",
        timezone: "Europe/Rome",
        logoUrl: null,
        photos: [],
      },
      guestSnapshot: {
        name: "Anna",
        checkIn: "2027-01-10",
        checkOut: "2027-01-12",
        occupancy: { adults: 2, childAges: [] },
      },
      options: [
        {
          roomId: "room-1",
          roomName: "Camera Doppia",
          planCode: "breakfast",
          planName: "Colazione inclusa",
          mealPlan: "breakfast",
          currency: "EUR",
          nights: [
            {
              date: "2027-01-10",
              ratePeriodId: "rate-1",
              baseCents: 11_000,
              extraAdultCents: 0,
              extraChildCents: 0,
              totalCents: 11_000,
            },
            {
              date: "2027-01-11",
              ratePeriodId: "rate-1",
              baseCents: 11_000,
              extraAdultCents: 0,
              extraChildCents: 0,
              totalCents: 11_000,
            },
          ],
          totalCents: 22_000,
        },
      ],
    },
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    acceptedAt: null,
    selectedOptionIndex: null,
    revokedAt: null,
    createdAt: now,
  };
}

function connectWaha(repositories: MemoryRepositories, hotelId: string) {
  setConnection(repositories, hotelId, "waha", {
    credentials: sealPrivateValue(JSON.stringify({ apiKey: "waha-secret" }), secret),
    metadata: { baseUrl: "https://waha.example", sessionName: "hotel-main" },
  });
}

function connectGoogle(repositories: MemoryRepositories, hotelId: string) {
  setConnection(repositories, hotelId, "google", {
    credentials: sealPrivateValue(
      JSON.stringify({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        accessTokenExpiresAt: "2030-01-01T00:00:00.000Z",
        scope: "https://www.googleapis.com/auth/gmail.send",
        tokenType: "Bearer",
      }),
      secret,
    ),
    metadata: {},
  });
}

function setConnection(
  repositories: MemoryRepositories,
  hotelId: string,
  kind: ConnectionKind,
  input: { credentials: string; metadata: Record<string, unknown> },
) {
  repositories.channels.connections.set(`${hotelId}:${kind}`, {
    id: randomUUID(),
    hotelId,
    kind,
    state: "connected",
    encryptedCredentials: input.credentials,
    metadata: input.metadata,
    lastCheckedAt: now,
    lastErrorCode: null,
    createdAt: now,
    updatedAt: now,
  });
}
