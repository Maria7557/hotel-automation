import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { sealPrivateValue, unsealPrivateValue } from "../src/lib/public-token.js";
import type { ProviderFetch } from "../src/providers/http.js";
import { createMemoryRepositories, type MemoryRepositories } from "./helpers/memory-repositories.js";

const env = {
  AUTH_SECRET: "test-auth-secret-that-is-at-least-32-characters",
  SESSION_TTL_DAYS: 30,
  PUBLIC_BASE_URL: "https://offers.example",
  corsOrigins: ["http://localhost:8081"],
  GOOGLE_CLIENT_ID: "synthetic-google-id",
  GOOGLE_CLIENT_SECRET: "synthetic-google-secret",
  GOOGLE_REDIRECT_URI: "https://api.example/v1/connections/google/oauth/callback",
  MICROSOFT_CLIENT_ID: "synthetic-microsoft-id",
  MICROSOFT_CLIENT_SECRET: "synthetic-microsoft-secret",
  MICROSOFT_REDIRECT_URI: "https://api.example/v1/connections/mail/microsoft/oauth/callback",
};
type MailKind = "google" | "microsoft";
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const tokenResponse = () => json({ access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 3600 });
const isTokenUrl = (url: string) => url.endsWith("/token");

async function onboard(app: FastifyInstance, email: string) {
  const registered = await app.inject({ method: "POST", url: "/v1/auth/register", payload: {
    email, password: "a-strong-password", displayName: "Owner",
  } });
  expect(registered.statusCode).toBe(201);
  const token = registered.json().data.accessToken as string;
  const hotel = await app.inject({ method: "POST", url: "/v1/hotel", headers: auth(token), payload: {
    name: "Lifecycle Hotel", city: "Firenze",
  } });
  expect(hotel.statusCode).toBe(201);
  return { token, hotelId: hotel.json().data.hotel.id as string };
}

describe("mail connection lifecycle races", () => {
  let app: FastifyInstance;
  let repositories: MemoryRepositories;
  let fetcher: ReturnType<typeof vi.fn<ProviderFetch>>;

  beforeEach(async () => {
    repositories = createMemoryRepositories();
    // All provider traffic stays in this fake. Unexpected requests fail closed.
    fetcher = vi.fn<ProviderFetch>(async (input) => { throw new Error(`Unexpected provider request: ${String(input)}`); });
    app = await createApp({ env, repositories, providerFetch: fetcher, logger: false });
  });
  afterEach(async () => { await app.close(); vi.restoreAllMocks(); });

  async function connect(hotelId: string, kind: MailKind, expired = false, accessToken = "original-access") {
    return repositories.channels.activateMailConnectionForHotel({
      hotelId, kind,
      encryptedCredentials: sealPrivateValue(JSON.stringify({
        accessToken, refreshToken: "original-refresh", scope: null,
        accessTokenExpiresAt: expired ? "2000-01-01T00:00:00.000Z" : "2099-01-01T00:00:00.000Z",
      }), env.AUTH_SECRET),
      metadata: { email: "sender@example.com" }, lastCheckedAt: new Date(), lastErrorCode: null,
    });
  }
  function credentials(hotelId: string, kind: MailKind) {
    const stored = repositories.channels.connections.get(`${hotelId}:${kind}`);
    return JSON.parse(unsealPrivateValue(stored!.encryptedCredentials!, env.AUTH_SECRET));
  }
  function sendTest(token: string) {
    return app.inject({ method: "POST", url: "/v1/hotel/message-settings/test-send", headers: auth(token),
      payload: { channel: "email", recipient: "recipient@example.com" },
    }).then((response) => response);
  }
  async function startOAuth(token: string, kind: MailKind) {
    const start = await app.inject({ method: "POST", url: `/v1/connections/mail/${kind}/oauth/start`,
      headers: auth(token), payload: { email: "sender@example.com" },
    });
    expect(start.statusCode).toBe(200);
    return new URL(start.json().data.authorizationUrl).searchParams.get("state")!;
  }
  function callback(kind: MailKind, state: string) {
    return app.inject({ method: "GET", url: `/v1/connections/mail/${kind}/oauth/callback?state=${encodeURIComponent(state)}&code=synthetic-code` })
      .then((response) => response);
  }

  describe.each<MailKind>(["google", "microsoft"])("%s", (kind) => {
    it("rejects an exchanged OAuth callback if the user disconnected while exchange was pending", async () => {
      const owner = await onboard(app, "cancel@example.com");
      const entered = deferred();
      const release = deferred<Response>();
      fetcher.mockImplementation(async (input) => {
        expect(isTokenUrl(String(input))).toBe(true);
        entered.resolve();
        return release.promise;
      });
      const pending = callback(kind, await startOAuth(owner.token, kind));
      await entered.promise;
      try {
        const disconnected = await app.inject({ method: "DELETE", url: "/v1/connections/mail", headers: auth(owner.token) });
        expect(disconnected.statusCode).toBe(200);
      } finally { release.resolve(tokenResponse()); }
      expect((await pending).statusCode).toBe(409);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(repositories.channels.connections.get(`${owner.hotelId}:${kind}`)).toMatchObject({ state: "disconnected", encryptedCredentials: null });
    });

    it("does not send or activate an old OAuth callback after a different provider is activated", async () => {
      const owner = await onboard(app, "replace@example.com");
      const replacement: MailKind = kind === "google" ? "microsoft" : "google";
      const entered = deferred();
      const release = deferred<Response>();
      fetcher.mockImplementation(async () => { entered.resolve(); return release.promise; });
      const pending = callback(kind, await startOAuth(owner.token, kind));
      await entered.promise;
      try { await connect(owner.hotelId, replacement, false, "replacement-access"); }
      finally { release.resolve(tokenResponse()); }
      expect((await pending).statusCode).toBe(409);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(repositories.channels.connections.get(`${owner.hotelId}:${replacement}`)?.state).toBe("connected");
      expect(credentials(owner.hotelId, replacement).accessToken).toBe("replacement-access");
      expect(repositories.channels.connections.get(`${owner.hotelId}:${kind}`)?.state).toBe("disconnected");
    });

    it("preserves a newer same-provider OAuth attempt when an older exchange completes", async () => {
      const owner = await onboard(app, "new-attempt@example.com");
      const entered = deferred();
      const release = deferred<Response>();
      fetcher.mockImplementation(async () => { entered.resolve(); return release.promise; });
      const pending = callback(kind, await startOAuth(owner.token, kind));
      await entered.promise;
      let newerNonce: unknown;
      try {
        await startOAuth(owner.token, kind);
        newerNonce = repositories.channels.connections.get(`${owner.hotelId}:${kind}`)?.metadata.oauthNonceHash;
        expect(newerNonce).toBeTruthy();
      } finally { release.resolve(tokenResponse()); }
      expect((await pending).statusCode).toBe(409);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(repositories.channels.connections.get(`${owner.hotelId}:${kind}`)).toMatchObject({
        state: "connecting", metadata: { oauthNonceHash: newerNonce },
      });
    });

    it("refreshes concurrent expired sends once and saves rotated credentials before either provider send", async () => {
      const owner = await onboard(app, "refresh@example.com");
      await connect(owner.hotelId, kind, true);
      const entered = deferred();
      const release = deferred<Response>();
      let refreshes = 0;
      const sentTokens: string[] = [];
      fetcher.mockImplementation(async (input, init) => {
        if (isTokenUrl(String(input))) {
          refreshes += 1;
          expect(String(init?.body)).toContain("refresh_token=original-refresh");
          entered.resolve();
          return release.promise;
        }
        expect(credentials(owner.hotelId, kind)).toMatchObject({ accessToken: "rotated-access", refreshToken: "rotated-refresh" });
        sentTokens.push(new Headers(init?.headers).get("Authorization")!);
        return json({ id: "synthetic-message" });
      });
      const bothSelected = deferred();
      const list = repositories.channels.listConnectionsForUser.bind(repositories.channels);
      let selections = 0;
      vi.spyOn(repositories.channels, "listConnectionsForUser").mockImplementation(async (userId) => {
        const snapshot = await list(userId);
        if (++selections === 2) bothSelected.resolve();
        return snapshot;
      });
      const first = sendTest(owner.token);
      await entered.promise;
      const second = sendTest(owner.token);
      await bothSelected.promise;
      release.resolve(tokenResponse());
      const results = await Promise.all([first, second]);
      for (const result of results) expect(result.json().data).toMatchObject({ provider: kind === "google" ? "gmail" : kind, accepted: true });
      expect(refreshes).toBe(1);
      expect(sentTokens).toEqual(["Bearer rotated-access", "Bearer rotated-access"]);
    });

    it("releases the hotel lock after a provider failure so a reconnected account can send", async () => {
      const owner = await onboard(app, "release-lock@example.com");
      await connect(owner.hotelId, kind);
      fetcher.mockResolvedValueOnce(json({ error: "synthetic failure" }, 403));
      const failed = await sendTest(owner.token);
      expect(failed.json().data).toMatchObject({ accepted: false, delivery: { state: "failed" } });
      await connect(owner.hotelId, kind, false, "reconnected-access");
      fetcher.mockImplementation(async (_input, init) => {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer reconnected-access");
        return json({ id: "recovered-message" });
      });
      const recovered = await sendTest(owner.token);
      expect(recovered.json().data).toMatchObject({ accepted: true, delivery: { state: "provider_accepted" } });
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("keeps rotated refresh credentials even if the following provider send fails", async () => {
      const owner = await onboard(app, "failure@example.com");
      await connect(owner.hotelId, kind, true);
      fetcher.mockImplementation(async (input) => {
        if (isTokenUrl(String(input))) return tokenResponse();
        expect(credentials(owner.hotelId, kind).refreshToken).toBe("rotated-refresh");
        return json({ error: "synthetic failure" }, 403);
      });
      const result = await sendTest(owner.token);
      expect(result.json().data).toMatchObject({ provider: kind === "google" ? "gmail" : kind, accepted: false, delivery: { state: "failed" } });
      expect(credentials(owner.hotelId, kind)).toMatchObject({ accessToken: "rotated-access", refreshToken: "rotated-refresh" });
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  it("does not send an old request through a replacement account after reconnect starts", async () => {
    const owner = await onboard(app, "reconnect@example.com");
    await connect(owner.hotelId, "google", false, "original-identity");
    const captured = deferred();
    const release = deferred();
    const list = repositories.channels.listConnectionsForUser.bind(repositories.channels);
    vi.spyOn(repositories.channels, "listConnectionsForUser").mockImplementationOnce(async (userId) => {
      const snapshot = await list(userId);
      captured.resolve();
      await release.promise;
      return snapshot;
    });
    fetcher.mockImplementation(async () => json({ id: "unexpected-message" }));
    const pending = sendTest(owner.token);
    await captured.promise;
    try {
      await startOAuth(owner.token, "google");
      await connect(owner.hotelId, "google", false, "replacement-identity");
    } finally { release.resolve(); }
    const result = await pending;
    expect(result.json().data.accepted).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(credentials(owner.hotelId, "google").accessToken).toBe("replacement-identity");
    expect(repositories.channels.connections.get(`${owner.hotelId}:google`)?.state).toBe("connected");
  });

  it("allows another hotel to send while one hotel's provider request is blocked", async () => {
    const owner = await onboard(app, "blocked@example.com");
    const other = await onboard(app, "independent@example.com");
    await connect(owner.hotelId, "google", false, "blocked-access");
    await connect(other.hotelId, "google", false, "independent-access");
    const entered = deferred();
    const release = deferred<Response>();
    fetcher.mockImplementation(async (_input, init) => {
      if (new Headers(init?.headers).get("Authorization") === "Bearer blocked-access") {
        entered.resolve();
        return release.promise;
      }
      return json({ id: "independent-message" });
    });
    const first = sendTest(owner.token);
    await entered.promise;
    try {
      const result = await sendTest(other.token);
      expect(result.json().data).toMatchObject({ provider: "gmail", accepted: true });
    } finally { release.resolve(json({ id: "blocked-message" })); }
    expect((await first).json().data.accepted).toBe(true);
  });
});
