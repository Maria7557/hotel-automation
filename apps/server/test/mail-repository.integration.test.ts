import { sealPrivateValue, unsealPrivateValue } from "../src/lib/public-token.js";
import { GoogleProvider } from "../src/providers/google.js";
import { MicrosoftProvider } from "../src/providers/microsoft.js";
import { SmtpProvider } from "../src/providers/smtp.js";
import { MailSender } from "../src/services/mail-sender.js";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../src/db/client.js";
import { connections, deliveries, hotels, hotelMembers, users } from "../src/db/schema.js";
import { createPostgresRepositories } from "../src/repositories/postgres.js";

const databaseUrl = process.env.MAIL_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("mail repository PostgreSQL integration", () => {
  let core: ReturnType<typeof createDatabase>;
  let secondCore: ReturnType<typeof createDatabase>;
  let secondRepositories: ReturnType<typeof createPostgresRepositories>;
  let repositories: ReturnType<typeof createPostgresRepositories>;
  const hotelIds: string[] = [];
  const userIds: string[] = [];
  beforeAll(async () => {
    core = createDatabase(databaseUrl!);
    await migrate(core.db, { migrationsFolder: "./drizzle" });
    repositories = createPostgresRepositories(core.db);
    secondCore = createDatabase(databaseUrl!);
    secondRepositories = createPostgresRepositories(secondCore.db);
  }, 20_000);
  afterEach(async () => {
    for (const id of hotelIds.splice(0)) await core.db.delete(hotels).where(eq(hotels.id, id));
    for (const id of userIds.splice(0)) await core.db.delete(users).where(eq(users.id, id));
  });
  afterAll(async () => { await secondCore?.client.end(); await core?.client.end(); });

  async function hotel() {
    const [row] = await core.db.insert(hotels).values({ name: "Synthetic mail test", city: "Test" }).returning();
    hotelIds.push(row!.id);
    return row!.id;
  }
  function activate(hotelId: string, kind: "google" | "microsoft" | "smtp") {
    return repositories.channels.activateMailConnectionForHotel({ hotelId, kind, encryptedCredentials: `synthetic-${kind}`, metadata: {}, lastCheckedAt: new Date(), lastErrorCode: null });
  }
  async function claim(hotelId: string) {
    await core.db.insert(deliveries).values({ hotelId, kind: "offer", channel: "email", state: "scheduled", recipient: "synthetic@example.com", payload: {}, idempotencyKey: randomUUID(), nextAttemptAt: new Date(0) });
    return repositories.deliveryWorker.claimNextOfferDelivery(new Date());
  }

  it("selects the connected account even when another provider was inserted first", async () => {
    const id = await hotel();
    await activate(id, "google");
    await activate(id, "microsoft");
    expect((await claim(id))?.connection).toMatchObject({ kind: "microsoft", state: "connected" });
  });

  it("does not choose a sender for ambiguous legacy rows", async () => {
    const id = await hotel();
    await activate(id, "google");
    await core.db.insert(connections).values({ hotelId: id, kind: "smtp", state: "connected", encryptedCredentials: "synthetic" });
    expect((await claim(id))?.connection).toBeNull();
  });

  it("serializes simultaneous successful connections and does not affect another hotel", async () => {
    const id = await hotel();
    const other = await hotel();
    await activate(other, "google");
    await Promise.all([activate(id, "google"), activate(id, "microsoft"), activate(id, "smtp")]);
    const rows = await core.db.select().from(connections).where(eq(connections.hotelId, id));
    expect(rows.filter((row) => row.state === "connected")).toHaveLength(1);
    expect(rows.filter((row) => row.state !== "connected").every((row) => row.encryptedCredentials === null)).toBe(true);
    expect(await core.db.select().from(connections).where(eq(connections.hotelId, other))).toEqual([expect.objectContaining({ kind: "google", state: "connected" })]);
  });

  it("rejects a stale credential update after switching providers", async () => {
    const id = await hotel();
    await activate(id, "google");
    await activate(id, "microsoft");
    const updated = await repositories.channels.updateConnectionForHotel({ hotelId: id, kind: "google", state: "connected", expectedEncryptedCredentials: "synthetic-google", encryptedCredentials: "rotated-but-stale", lastCheckedAt: new Date(), lastErrorCode: null });
    expect(updated).toBeNull();
    expect((await claim(id))?.connection?.kind).toBe("microsoft");
  });

  it("holds a hotel lock across distinct PostgreSQL sessions without blocking another hotel, and releases it on error", async () => {
    const id = await hotel();
    const other = await hotel();
    const [firstPid] = await core.client`select pg_backend_pid() as pid`;
    const [secondPid] = await secondCore.client`select pg_backend_pid() as pid`;
    expect(firstPid!.pid).not.toBe(secondPid!.pid);
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const first = repositories.channels.withMailConnectionLock(id, async (scoped) => {
      entered();
      await held;
      await expect(scoped.listConnectionsForHotel(other)).rejects.toThrow("MAIL_LOCK_SCOPE_MISMATCH");
      throw new Error("synthetic failure");
    });
    const firstResult = expect(first).rejects.toThrow("synthetic failure");
    await ready;
    let secondEntered = false;
    const second = secondRepositories.channels.withMailConnectionLock(id, async () => { secondEntered = true; });
    try {
      await secondRepositories.channels.withMailConnectionLock(other, async () => undefined);
      let waiting = 0;
      for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
        const [row] = await core.client`select count(*)::int as count from pg_locks where locktype = 'advisory' and granted = true and database = (select oid from pg_database where datname = current_database())`;
        waiting = row!.count;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBeGreaterThan(0);
      expect(secondEntered).toBe(false);
    } finally { release(); }
    await firstResult;
    await second;
    expect(secondEntered).toBe(true);
  });

  const secret = "synthetic-mail-integration-secret-over-32-characters";
  const config = { MICROSOFT_CLIENT_ID: "id", MICROSOFT_CLIENT_SECRET: "secret", MICROSOFT_REDIRECT_URI: "https://example.com/callback" };
  const credentialData = { accessToken: "old", refreshToken: "old-refresh", accessTokenExpiresAt: "2000-01-01T00:00:00.000Z", scope: "Mail.Send" };

  it("serializes actual multi-session refresh and commits rotated credentials before external sends", async () => {
    const id = await hotel();
    const snapshot = (await repositories.channels.activateMailConnectionForHotel({ hotelId: id, kind: "microsoft", encryptedCredentials: sealPrivateValue(JSON.stringify(credentialData), secret), metadata: {}, lastCheckedAt: new Date(), lastErrorCode: null }))!;
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    let refreshes = 0;
    const tokens: string[] = [];
    const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("/token")) {
        refreshes += 1;
        entered();
        await held;
        return new Response(JSON.stringify({ access_token: "rotated", refresh_token: "rotated-refresh", expires_in: 3600 }), { status: 200 });
      }
      const current = (await secondRepositories.channels.listConnectionsForHotel(id))[0]!;
      expect(JSON.parse(unsealPrivateValue(current.encryptedCredentials!, secret))).toMatchObject({ refreshToken: "rotated-refresh" });
      tokens.push(new Headers(init?.headers).get("Authorization")!);
      return new Response(null, { status: 202 });
    });
    const sender = (channels: typeof repositories.channels) => new MailSender(channels, secret, config, new GoogleProvider(fetcher), new MicrosoftProvider(fetcher), new SmtpProvider());
    const message = { to: "synthetic@example.com", subject: "Synthetic", html: "<p>Synthetic</p>" };
    const first = sender(repositories.channels).send(snapshot, message);
    await ready;
    const second = sender(secondRepositories.channels).send(snapshot, message);
    try {
      let waiting = 0;
      for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
        const [row] = await core.client`select count(*)::int as count from pg_locks where locktype = 'advisory' and granted = true and database = (select oid from pg_database where datname = current_database())`;
        waiting = row!.count;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBeGreaterThan(0);
    } finally { release(); }
    await Promise.all([first, second]);
    expect(refreshes).toBe(1);
    expect(tokens).toEqual(["Bearer rotated", "Bearer rotated"]);
  });

  it("keeps refreshed credentials committed when the provider subsequently rejects the send", async () => {
    const id = await hotel();
    const snapshot = (await repositories.channels.activateMailConnectionForHotel({ hotelId: id, kind: "microsoft", encryptedCredentials: sealPrivateValue(JSON.stringify(credentialData), secret), metadata: {}, lastCheckedAt: new Date(), lastErrorCode: null }))!;
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "rotated", refresh_token: "rotated-refresh", expires_in: 3600 }), { status: 200 })).mockResolvedValueOnce(new Response(null, { status: 403 }));
    const sender = new MailSender(repositories.channels, secret, config, new GoogleProvider(fetcher), new MicrosoftProvider(fetcher), new SmtpProvider());
    await expect(sender.send(snapshot, { to: "synthetic@example.com", subject: "Synthetic", html: "test" })).rejects.toMatchObject({ code: "MICROSOFT_SEND_HTTP_403" });
    const current = (await secondRepositories.channels.listConnectionsForHotel(id))[0]!;
    expect(JSON.parse(unsealPrivateValue(current.encryptedCredentials!, secret))).toMatchObject({ refreshToken: "rotated-refresh" });
  });

  it("rejects an old account snapshot after waiting for a simultaneous same-provider replacement", async () => {
    const id = await hotel();
    const snapshot = (await activate(id, "microsoft"))!;
    const fetcher = vi.fn();
    const sender = new MailSender(secondRepositories.channels, secret, config, new GoogleProvider(fetcher), new MicrosoftProvider(fetcher), new SmtpProvider());
    let sending: ReturnType<typeof sender.send>;
    let result: Promise<unknown>;
    await repositories.channels.withMailConnectionLock(id, async (scoped) => {
      sending = sender.send(snapshot, { to: "synthetic@example.com", subject: "Synthetic", html: "test" });
      result = expect(sending).rejects.toMatchObject({ code: "EMAIL_CONNECTION_NOT_READY" });
      await scoped.activateMailConnectionForHotel({ hotelId: id, kind: "microsoft", encryptedCredentials: "replacement", metadata: {}, lastCheckedAt: new Date(), lastErrorCode: null });
    });
    await result!;
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not activate a consumed OAuth attempt after a newer attempt or a disconnect", async () => {
    const id = await hotel();
    await core.db.insert(connections).values({ hotelId: id, kind: "google", state: "connecting", metadata: { oauthAttemptId: "newer-attempt" } });
    const input = { hotelId: id, kind: "google" as const, encryptedCredentials: "stale", metadata: {}, lastCheckedAt: new Date(), lastErrorCode: null };
    expect(await repositories.channels.activateMailConnectionForHotel({ ...input, expectedOAuthAttemptId: "older-attempt" })).toBeNull();
    expect((await secondRepositories.channels.listConnectionsForHotel(id))[0]?.metadata.oauthAttemptId).toBe("newer-attempt");
    await secondRepositories.channels.updateConnectionForHotel({ hotelId: id, kind: "google", state: "disconnected", lastCheckedAt: new Date(), lastErrorCode: null });
    expect(await repositories.channels.activateMailConnectionForHotel({ ...input, expectedOAuthAttemptId: "newer-attempt" })).toBeNull();
  });


  it("does not exhaust the pool when many distinct hotels activate simultaneously", async () => {
    const ids = await Promise.all(Array.from({ length: 16 }, () => hotel()));
    const results = await Promise.all(ids.map((id) => activate(id, "microsoft")));
    expect(results).toHaveLength(16);
    expect(results.every((row) => row?.state === "connected")).toBe(true);
  }, 10_000);

  it("enforces the locked hotel on user-based connection reads and mutations", async () => {
    const id = await hotel();
    const other = await hotel();
    const [user] = await core.db.insert(users).values({ email: `synthetic-${randomUUID()}@example.com` }).returning();
    userIds.push(user!.id);
    await core.db.insert(hotelMembers).values({ userId: user!.id, hotelId: other, role: "owner" });
    await activate(other, "google");
    await repositories.channels.withMailConnectionLock(id, async (scoped) => {
      await expect(scoped.findConnectionForUser(user!.id, "google")).rejects.toThrow("MAIL_LOCK_SCOPE_MISMATCH");
      await expect(scoped.updateConnectionForHotel({ hotelId: other, kind: "google", state: "disconnected", lastCheckedAt: new Date(), lastErrorCode: null })).rejects.toThrow("MAIL_LOCK_SCOPE_MISMATCH");
    });
    expect((await secondRepositories.channels.listConnectionsForHotel(other))[0]?.state).toBe("connected");
  });


  it("aborts a lost lock during refresh and never saves or sends using the stale operation", async () => {
    const id = await hotel();
    const snapshot = (await repositories.channels.activateMailConnectionForHotel({ hotelId: id, kind: "microsoft", encryptedCredentials: sealPrivateValue(JSON.stringify(credentialData), secret), metadata: {}, lastCheckedAt: new Date(), lastErrorCode: null }))!;
    let entered!: () => void;
    let resolveToken!: (value: Response) => void;
    let aborted!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const token = new Promise<Response>((resolve) => { resolveToken = resolve; });
    const cancelled = new Promise<void>((resolve) => { aborted = resolve; });
    const fetcher = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      init!.signal!.addEventListener("abort", () => aborted(), { once: true });
      entered();
      return token; // Deliberately ignore abort to prove the database guard also works.
    });
    const sender = new MailSender(repositories.channels, secret, config, new GoogleProvider(fetcher), new MicrosoftProvider(fetcher), new SmtpProvider());
    const sending = sender.send(snapshot, { to: "synthetic@example.com", subject: "Synthetic", html: "test" });
    const outcome = expect(sending).rejects.toMatchObject({ code: "EMAIL_CONNECTION_INTERRUPTED" });
    await ready;
    try {
      const [lock] = await core.client`select pid from pg_locks where locktype = 'advisory' and granted and database = (select oid from pg_database where datname = current_database())`;
      expect(lock).toBeDefined();
      await core.client`select pg_terminate_backend(${lock!.pid})`;
      await cancelled;
      await secondRepositories.channels.activateMailConnectionForHotel({ hotelId: id, kind: "microsoft", encryptedCredentials: "replacement-after-failure", metadata: {}, lastCheckedAt: new Date(), lastErrorCode: null });
    } finally { resolveToken(new Response(JSON.stringify({ access_token: "stale", refresh_token: "stale-refresh", expires_in: 3600 }), { status: 200 })); }
    await outcome;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await secondRepositories.channels.listConnectionsForHotel(id))[0]?.encryptedCredentials).toBe("replacement-after-failure");
  });

  it("preserves provider acceptance when the lock connection is lost just after the provider accepted", async () => {
    const id = await hotel();
    const snapshot = (await repositories.channels.activateMailConnectionForHotel({ hotelId: id, kind: "microsoft", encryptedCredentials: sealPrivateValue(JSON.stringify({ ...credentialData, accessTokenExpiresAt: "2099-01-01T00:00:00.000Z" }), secret), metadata: {}, lastCheckedAt: new Date(), lastErrorCode: null }))!;
    const fetcher = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const cancelled = new Promise<void>((resolve) => init!.signal!.addEventListener("abort", () => resolve(), { once: true }));
      const [lock] = await core.client`select pid from pg_locks where locktype = 'advisory' and granted and database = (select oid from pg_database where datname = current_database())`;
      await core.client`select pg_terminate_backend(${lock!.pid})`;
      await cancelled;
      return new Response(null, { status: 202, headers: { "request-id": "accepted-before-disconnect" } });
    });
    const sender = new MailSender(repositories.channels, secret, config, new GoogleProvider(fetcher), new MicrosoftProvider(fetcher), new SmtpProvider());
    await expect(sender.send(snapshot, { to: "synthetic@example.com", subject: "Synthetic", html: "test" })).resolves.toMatchObject({ providerMessageId: "accepted-before-disconnect", connectionUpdateFailed: true });
    await expect(secondRepositories.channels.withMailConnectionLock(id, async () => "released")).resolves.toBe("released");
  });

});
