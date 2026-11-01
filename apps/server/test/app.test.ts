import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { createMemoryRepositories, type MemoryRepositories } from "./helpers/memory-repositories.js";

const testEnv = {
  AUTH_SECRET: "test-auth-secret-that-is-at-least-32-characters",
  SESSION_TTL_DAYS: 30,
  corsOrigins: ["http://localhost:8081"],
};

describe("server API", () => {
  let app: FastifyInstance;
  let repositories: MemoryRepositories;

  beforeEach(async () => {
    repositories = createMemoryRepositories();
    app = await createApp({ env: testEnv, repositories, logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("reports database readiness", async () => {
    const healthy = await app.inject({ method: "GET", url: "/health" });
    expect(healthy.statusCode).toBe(200);
    expect(healthy.json()).toMatchObject({ status: "ok", dependencies: { database: "up" } });

    repositories.system.databaseUp = false;
    const degraded = await app.inject({ method: "GET", url: "/health" });
    expect(degraded.statusCode).toBe(503);
    expect(degraded.json()).toMatchObject({ status: "degraded", dependencies: { database: "down" } });
  });

  it("registers, restores and ends an opaque session", async () => {
    const registration = await register(app, "Owner@Example.com");
    expect(registration.statusCode).toBe(201);
    const registrationBody = registration.json();
    expect(registrationBody.data.user.email).toBe("owner@example.com");
    expect(registrationBody.data.accessToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect([...repositories.auth.sessions.keys()][0]).not.toBe(registrationBody.data.accessToken);
    const setCookie = registration.headers["set-cookie"];
    expect(setCookie).toContain("hotel_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Max-Age=");
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const cookie = cookieHeader?.split(";", 1)[0];
    expect(cookie).toBeTruthy();

    const session = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().data.user.email).toBe("owner@example.com");

    const logout = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers["set-cookie"]).toContain("hotel_session=;");

    const endedSession = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie },
    });
    expect(endedSession.statusCode).toBe(401);
  });

  it("rejects duplicate registration and invalid login without leaking which check failed", async () => {
    expect((await register(app, "owner@example.com")).statusCode).toBe(201);
    const duplicate = await register(app, "OWNER@example.com");
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("EMAIL_IN_USE");

    const invalidPassword = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "owner@example.com", password: "wrong-password" },
    });
    expect(invalidPassword.statusCode).toBe(401);
    expect(invalidPassword.json().error.code).toBe("INVALID_CREDENTIALS");

    const missingAccount = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "nobody@example.com", password: "wrong-password" },
    });
    expect(missingAccount.statusCode).toBe(401);
    expect(missingAccount.json().error.code).toBe("INVALID_CREDENTIALS");
  });

  it("creates, reads and updates the authenticated owner's hotel", async () => {
    const accessToken = await registeredToken(app, "owner@example.com");
    const create = await app.inject({
      method: "POST",
      url: "/v1/hotel",
      headers: auth(accessToken),
      payload: { name: "Casa Blu", city: "Firenze" },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().data.hotel).toMatchObject({
      name: "Casa Blu",
      city: "Firenze",
      countryCode: "IT",
      locale: "en-GB",
      currency: "EUR",
      timezone: "Europe/Rome",
      photoUrls: [],
    });

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/hotel",
      headers: auth(accessToken),
      payload: { name: "Another Hotel", city: "Roma" },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("HOTEL_EXISTS");

    const update = await app.inject({
      method: "PATCH",
      url: "/v1/hotel",
      headers: auth(accessToken),
      payload: {
        description: "A small hotel near the sea.",
        email: "hello@casablu.example",
        photoUrls: ["https://images.example/hotel.jpg"],
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().data.hotel).toMatchObject({
      name: "Casa Blu",
      email: "hello@casablu.example",
      photoUrls: ["https://images.example/hotel.jpg"],
    });

    const read = await app.inject({ method: "GET", url: "/v1/hotel", headers: auth(accessToken) });
    expect(read.statusCode).toBe(200);
    expect(read.json().data.hotel.description).toBe("A small hotel near the sea.");
  });

  it("isolates hotel profiles between users", async () => {
    const ownerToken = await registeredToken(app, "owner@example.com");
    const otherToken = await registeredToken(app, "other@example.com");
    await app.inject({
      method: "POST",
      url: "/v1/hotel",
      headers: auth(ownerToken),
      payload: { name: "Owner Hotel", city: "Milano" },
    });

    const otherRead = await app.inject({ method: "GET", url: "/v1/hotel", headers: auth(otherToken) });
    expect(otherRead.statusCode).toBe(404);
    expect(otherRead.json().error.code).toBe("HOTEL_NOT_FOUND");
  });

  it("soft deletes a hotel only after exact name confirmation", async () => {
    const accessToken = await registeredToken(app, "owner@example.com");
    await app.inject({
      method: "POST",
      url: "/v1/hotel",
      headers: auth(accessToken),
      payload: { name: "Casa Blu", city: "Firenze" },
    });

    const mismatch = await app.inject({
      method: "DELETE",
      url: "/v1/hotel",
      headers: auth(accessToken),
      payload: { confirmName: "Wrong" },
    });
    expect(mismatch.statusCode).toBe(409);

    const removed = await app.inject({
      method: "DELETE",
      url: "/v1/hotel",
      headers: auth(accessToken),
      payload: { confirmName: "Casa Blu" },
    });
    expect(removed.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/v1/hotel", headers: auth(accessToken) })).statusCode).toBe(404);
  });

  it("returns structured validation errors", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "bad", password: "short" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(response.json().error.details.length).toBeGreaterThan(0);
  });
});

function register(app: FastifyInstance, email: string) {
  return app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: "a-strong-password", displayName: "Owner" },
  });
}

async function registeredToken(app: FastifyInstance, email: string): Promise<string> {
  const response = await register(app, email);
  return response.json().data.accessToken as string;
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
