import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { digestSessionToken } from "../src/lib/session-token.js";
import { passwordResetTokenFromHash } from "../../mobile/src/auth/password-reset-link.js";
import { createMemoryRepositories, type MemoryRepositories } from "./helpers/memory-repositories.js";

const env = {
  AUTH_SECRET: "password-reset-test-secret-at-least-32-characters",
  SESSION_TTL_DAYS: 30,
  APP_BASE_URL: "https://staff.example/",
  corsOrigins: [],
};
const oldPassword = "old-strong-password";
const newPassword = "new-strong-password";

describe("password recovery API", () => {
  let app: FastifyInstance;
  let repositories: MemoryRepositories;
  let messages: Array<{ to: string; subject: string; text: string }>;

  beforeEach(async () => {
    messages = [];
    repositories = createMemoryRepositories();
    app = await createApp({ env, repositories, passwordResetMailer: {
      configured: true, send: async (message) => { messages.push(message); },
    } });
  });
  afterEach(async () => { await app.close(); });

  const register = (email = "owner@example.com") => app.inject({ method: "POST", url: "/v1/auth/register",
    payload: { email, password: oldPassword, displayName: "Owner" } });
  const request = (email = "owner@example.com", headers = {}) => app.inject({ method: "POST", url: "/v1/auth/forgot-password", headers, payload: { email } });
  const reset = (token: string, password = newPassword) => app.inject({ method: "POST", url: "/v1/auth/reset-password", payload: { token, password } });
  const login = (password: string, email = "owner@example.com") => app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password } });
  const session = (token: string) => app.inject({ method: "GET", url: "/v1/auth/session", headers: { authorization: `Bearer ${token}` } });
  async function emailedToken(index = 0) {
    await vi.waitFor(() => expect(messages.length).toBeGreaterThan(index));
    const url = new URL(messages[index]!.text.split("\n\n")[1]!);
    const token = passwordResetTokenFromHash(url.hash);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.origin).toBe("https://staff.example");
    expect(url.search).toBe("");
    return token!;
  }

  it("returns identical responses for password, missing and social-only accounts without disclosing tokens", async () => {
    const owner = (await register()).json().data.user;
    await repositories.auth.findOrCreateSocialUser({ provider: "google", subject: "google-id", email: "social@example.com", displayName: "Social", allowEmailLink: true });
    const known = await request("OWNER@example.com", { host: "attacker.example" });
    const missing = await request("missing@example.com");
    const social = await request("social@example.com");
    for (const response of [known, missing, social]) {
      expect(response.statusCode).toBe(202);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toEqual(known.json());
      expect(response.body).not.toContain("token");
    }
    const token = await emailedToken();
    expect((await login(oldPassword)).statusCode).toBe(200);
    await app.close();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.to).toBe("owner@example.com");
    expect(repositories.auth.passwordResets.size).toBe(1);
    const stored = repositories.auth.passwordResets.get(owner.id)!;
    expect(stored.tokenHash).toBe(digestSessionToken(`password-reset:${token}`, env.AUTH_SECRET));
    expect(stored.tokenHash).not.toBe(digestSessionToken(token, env.AUTH_SECRET));
    expect(stored.expiresAt.getTime() - stored.requestedAt.getTime()).toBe(30 * 60_000);
  });

  it("changes the password, revokes every owner session, preserves other users and requires a fresh login", async () => {
    const first = (await register()).json().data;
    const second = (await login(oldPassword)).json().data;
    const other = (await register("other@example.com")).json().data;
    await request();
    const token = await emailedToken();
    expect((await session(first.accessToken)).statusCode).toBe(200);
    const response = await reset(token);
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(response.headers["set-cookie"]).toContain("hotel_session=;");
    expect((await login(oldPassword)).statusCode).toBe(401);
    expect((await session(first.accessToken)).statusCode).toBe(401);
    expect((await session(second.accessToken)).statusCode).toBe(401);
    expect((await session(other.accessToken)).statusCode).toBe(200);
    expect((await login(newPassword)).statusCode).toBe(200);
    expect((await reset(token, "replayed-password")).json().error.code).toBe("PASSWORD_RESET_INVALID");
    expect((await login(newPassword)).statusCode).toBe(200);
    await vi.waitFor(() => expect(messages).toHaveLength(2));
    expect(messages[1]!.subject).toBe("Your password has been changed");
    expect(messages[1]!.text).not.toContain(newPassword);
  });

  it("rejects expired and unknown links without changing passwords or sessions", async () => {
    const owner = (await register()).json().data;
    await request();
    const token = await emailedToken();
    repositories.auth.passwordResets.get(owner.user.id)!.expiresAt = new Date(Date.now() - 1);
    for (const invalid of [token, "x".repeat(43)]) {
      const response = await reset(invalid);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("PASSWORD_RESET_INVALID");
    }
    expect((await login(oldPassword)).statusCode).toBe(200);
    expect((await session(owner.accessToken)).statusCode).toBe(200);
  });

  it("allows only one concurrent use of a reset link", async () => {
    await register();
    await request();
    const token = await emailedToken();
    const results = await Promise.all([reset(token, "first-new-password"), reset(token, "second-new-password")]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([204, 400]);
    const winner = results[0]!.statusCode === 204 ? "first-new-password" : "second-new-password";
    expect((await login(winner)).statusCode).toBe(200);
  });

  it("rejects an old-password login that was in flight when the password was reset", async () => {
    await register();
    await request();
    const token = await emailedToken();
    const create = repositories.auth.createSession.bind(repositories.auth);
    let resume: (() => void) | undefined;
    const paused = new Promise<void>((resolve) => { resume = resolve; });
    const spy = vi.spyOn(repositories.auth, "createSession").mockImplementationOnce(async (input) => {
      await paused;
      return create(input);
    });
    const pendingLogin = Promise.resolve(login(oldPassword));
    try {
      await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce());
      expect((await reset(token)).statusCode).toBe(204);
    } finally {
      resume!();
    }
    expect((await pendingLogin).statusCode).toBe(401);
    expect(repositories.auth.sessions.size).toBe(0);
    expect((await login(newPassword)).statusCode).toBe(200);
  });

  it("throttles account emails and replaces previous links after the cooldown", async () => {
    const owner = (await register()).json().data.user;
    await request();
    const first = await emailedToken();
    await Promise.all([request(), request()]);
    expect(messages).toHaveLength(1);
    repositories.auth.passwordResets.get(owner.id)!.requestedAt = new Date(Date.now() - 61_000);
    await request();
    const second = await emailedToken(1);
    expect(first).not.toBe(second);
    expect((await reset(first)).json().error.code).toBe("PASSWORD_RESET_INVALID");
    expect((await reset(second)).statusCode).toBe(204);
  });

  it("validates email, token format and both password length bounds without consuming valid tokens", async () => {
    expect((await request("invalid")).statusCode).toBe(400);
    await register();
    await request();
    const token = await emailedToken();
    expect((await reset("malformed")).statusCode).toBe(400);
    expect((await reset(token, "short")).statusCode).toBe(400);
    expect((await reset(token, "x".repeat(129))).statusCode).toBe(400);
    expect((await reset(token, "x".repeat(128))).statusCode).toBe(204);
  });

  it("limits public requests by IP with Retry-After independently of account existence", async () => {
    for (let index = 0; index < 5; index++) expect((await request(`missing${index}@example.com`)).statusCode).toBe(202);
    const limited = await request();
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("uses the local proxy’s client IP while ignoring spoofed headers from remote clients", async () => {
    for (let index = 0; index < 5; index++) {
      expect((await request("missing@example.com", { "x-forwarded-for": "203.0.113.10" })).statusCode).toBe(202);
    }
    expect((await request("missing@example.com", { "x-forwarded-for": "203.0.113.10" })).statusCode).toBe(429);
    expect((await request("missing@example.com", { "x-forwarded-for": "203.0.113.11" })).statusCode).toBe(202);
    for (let index = 0; index < 6; index++) {
      const response = await app.inject({ method: "POST", url: "/v1/auth/forgot-password", remoteAddress: "203.0.113.12",
        headers: { "x-forwarded-for": `203.0.113.${20 + index}` }, payload: { email: "missing@example.com" } });
      expect(response.statusCode).toBe(index < 5 ? 202 : 429);
    }
  });

  it("serves Italian UI messages and uses the recipient’s language for emails", async () => {
    const owner = (await register()).json().data.user;
    await repositories.auth.updateUserLanguage(owner.id, "it");
    const response = await request("owner@example.com", { "accept-language": "it-IT" });
    expect(response.json().data.message).toContain("riceverai");
    const token = await emailedToken();
    expect(messages[0]!.subject).toBe("Reimposta la password");
    expect(messages[0]!.text).toContain("Scade tra 30 minuti");
    await reset(token);
    await vi.waitFor(() => expect(messages).toHaveLength(2));
    expect(messages[1]!.subject).toBe("La tua password è stata modificata");
  });

  it("reports unavailable email configuration equally for existing and missing accounts", async () => {
    await app.close();
    app = await createApp({ env, repositories });
    await register();
    for (const email of ["owner@example.com", "missing@example.com"]) {
      const response = await request(email);
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe("PASSWORD_RESET_UNAVAILABLE");
    }
    expect(repositories.auth.passwordResets.size).toBe(0);
  });

  it("responds without waiting for SMTP and drains pending email on shutdown", async () => {
    await app.close();
    let finish: (() => void) | undefined;
    const sending = new Promise<void>((resolve) => { finish = resolve; });
    app = await createApp({ env, repositories, passwordResetMailer: { configured: true, send: () => sending } });
    await register();
    const response = await request();
    expect(response.statusCode).toBe(202);
    let closed = false;
    const closing = app.close().then(() => { closed = true; });
    await new Promise((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    finish!();
    await closing;
    expect(closed).toBe(true);
  });

  it("contains SMTP failures and does not fail a completed password change", async () => {
    await register();
    await request();
    const token = await emailedToken();
    await app.close();
    app = await createApp({ env, repositories, passwordResetMailer: {
      configured: true, send: async () => { throw new Error("SMTP unavailable"); },
    } });
    expect((await reset(token)).statusCode).toBe(204);
    expect((await login(newPassword)).statusCode).toBe(200);
    repositories.auth.passwordResets.values().next().value!.requestedAt = new Date(Date.now() - 61_000);
    expect((await request()).statusCode).toBe(202);
    await app.close();
  });
});
