import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import type { ProviderFetch } from "../src/providers/http.js";
import { createMemoryRepositories, type MemoryRepositories } from "./helpers/memory-repositories.js";

describe("platform WhatsApp support", () => {
  let app: FastifyInstance;
  let repositories: MemoryRepositories;
  const providerFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/sessions?all=true")) {
      return json([{ name: "hotel-support", status: "WORKING", engine: "WEBJS", me: { id: "393331234567@c.us", pushName: "Casa Blu" } }]);
    }
    if (url.endsWith("/api/sessions/hotel-support/restart") && init?.method === "POST") {
      return json({ name: "hotel-support", status: "STARTING", engine: "WEBJS", me: null });
    }
    throw new Error(`Unexpected provider URL: ${url}`);
  });

  beforeEach(async () => {
    repositories = createMemoryRepositories();
    app = await createApp({
      env: {
        AUTH_SECRET: "test-auth-secret-that-is-at-least-32-characters",
        SESSION_TTL_DAYS: 30,
        corsOrigins: ["http://localhost:8081"],
        WAHA_BASE_URL: "https://waha.internal",
        WAHA_API_KEY: "must-never-leak",
        platformAdminEmails: ["admin@example.com"],
      },
      repositories,
      providerFetch: providerFetch as ProviderFetch,
      logger: false,
    });
  });

  afterEach(async () => {
    providerFetch.mockClear();
    await app.close();
  });

  it("hides the support control plane from ordinary hotel users", async () => {
    const token = await register(app, "hotel@example.com");
    expect((await app.inject({ method: "GET", url: "/v1/platform-admin/access", headers: auth(token) })).json().data).toEqual({ enabled: false });
    const denied = await app.inject({ method: "GET", url: "/v1/platform-admin/whatsapp/sessions", headers: auth(token) });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("FORBIDDEN");
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("shows operational metadata and restarts a session without exposing credentials", async () => {
    const token = await register(app, "ADMIN@example.com");
    const hotel = await app.inject({
      method: "POST",
      url: "/v1/hotel",
      headers: auth(token),
      payload: { name: "Casa Blu", city: "Firenze" },
    });
    const hotelId = hotel.json().data.hotel.id as string;
    const now = new Date();
    repositories.channels.connections.set(`${hotelId}:waha`, {
      id: "connection-1",
      hotelId,
      kind: "waha",
      state: "connected",
      encryptedCredentials: "sealed-platform-key",
      metadata: { sessionName: "hotel-support", baseUrl: "https://waha.internal" },
      lastCheckedAt: now,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    });

    const access = await app.inject({ method: "GET", url: "/v1/platform-admin/access", headers: auth(token) });
    expect(access.json().data).toEqual({ enabled: true });
    const sessions = await app.inject({ method: "GET", url: "/v1/platform-admin/whatsapp/sessions", headers: auth(token) });
    expect(sessions.statusCode).toBe(200);
    expect(sessions.json().data).toMatchObject({
      provider: { configured: true, reachable: true, errorCode: null },
      counts: { total: 1, connected: 1, attention: 0 },
      sessions: [{ hotelId, hotelName: "Casa Blu", health: "connected", phoneNumber: "393331234567", pushName: "Casa Blu" }],
    });
    expect(sessions.body).not.toContain("must-never-leak");
    expect(sessions.body).not.toContain("sealed-platform-key");
    expect(sessions.body).not.toContain("https://waha.internal");

    const restarted = await app.inject({
      method: "POST",
      url: `/v1/platform-admin/whatsapp/hotels/${hotelId}/restart`,
      headers: auth(token),
    });
    expect(restarted.statusCode).toBe(200);
    expect(restarted.json().data.session).toMatchObject({ hotelId, health: "connecting", providerStatus: "STARTING" });
    expect(repositories.channels.connections.get(`${hotelId}:waha`)).toMatchObject({
      state: "connecting",
      metadata: { sessionName: "hotel-support", providerStatus: "STARTING", engine: "WEBJS" },
    });
  });
});

async function register(app: FastifyInstance, email: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: "a-strong-password", displayName: "User" },
  });
  return response.json().data.accessToken as string;
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
