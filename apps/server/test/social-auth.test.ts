import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import {
  SocialTokenVerificationError,
  type SocialTokenVerifier,
  type VerifiedSocialIdentity,
} from "../src/providers/social-auth.js";
import { createMemoryRepositories, type MemoryRepositories } from "./helpers/memory-repositories.js";

const testEnv = {
  AUTH_SECRET: "test-auth-secret-that-is-at-least-32-characters",
  SESSION_TTL_DAYS: 30,
  corsOrigins: ["http://localhost:8081"],
};

describe("social authentication", () => {
  let app: FastifyInstance;
  let repositories: MemoryRepositories;
  let identities: Map<string, VerifiedSocialIdentity>;
  let verifier: SocialTokenVerifier;

  beforeEach(async () => {
    repositories = createMemoryRepositories();
    identities = new Map();
    verifier = {
      verify: vi.fn(async (provider, idToken) => {
        if (idToken === "invalid-token-that-is-long-enough") throw new SocialTokenVerificationError();
        const identity = identities.get(idToken);
        if (!identity || identity.provider !== provider) throw new SocialTokenVerificationError();
        return identity;
      }),
    };
    app = await createApp({ env: testEnv, repositories, socialTokenVerifier: verifier, logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("creates a provider-only account and returns the ordinary opaque session", async () => {
    const token = "google-id-token-one-long-enough";
    identities.set(token, identity("google", "google-sub-1", "Owner@Example.com", "Hotel Owner"));

    const response = await socialLogin(app, "google", token);

    expect(response.statusCode).toBe(200);
    expect(response.json().data.user).toMatchObject({ email: "owner@example.com", displayName: "Hotel Owner" });
    expect(response.json().data.accessToken).toMatch(/^[A-Za-z0-9_-]+$/);
    const user = [...repositories.auth.users.values()][0];
    expect(user).toMatchObject({ passwordHash: null, googleSubject: "google-sub-1", appleSubject: null });

    const session = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { authorization: `Bearer ${response.json().data.accessToken as string}` },
    });
    expect(session.statusCode).toBe(200);
  });

  it("logs in by the stable provider subject even if the verified email changes", async () => {
    const firstToken = "google-id-token-first-long-enough";
    const secondToken = "google-id-token-second-long-enough";
    identities.set(firstToken, identity("google", "stable-google-sub", "first@example.com", null));
    identities.set(secondToken, identity("google", "stable-google-sub", "new@example.com", null));

    const first = await socialLogin(app, "google", firstToken);
    const second = await socialLogin(app, "google", secondToken);

    expect(second.statusCode).toBe(200);
    expect(second.json().data.user.id).toBe(first.json().data.user.id);
    expect(repositories.auth.users.size).toBe(1);
  });

  it("links a verified social identity to an existing account with the same normalized email", async () => {
    const registration = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "owner@example.com", password: "a-strong-password", displayName: "Owner" },
    });
    const token = "apple-id-token-one-long-enough";
    identities.set(token, identity("apple", "apple-sub-1", "OWNER@example.com", null));

    const response = await socialLogin(app, "apple", token);

    expect(response.statusCode).toBe(200);
    expect(response.json().data.user.id).toBe(registration.json().data.user.id);
    expect(repositories.auth.users.size).toBe(1);
    expect([...repositories.auth.users.values()][0]?.appleSubject).toBe("apple-sub-1");
  });

  it("refuses to replace an already linked subject for the same provider", async () => {
    const firstToken = "google-id-token-first-conflict";
    const secondToken = "google-id-token-second-conflict";
    identities.set(firstToken, identity("google", "google-sub-a", "owner@example.com", null));
    identities.set(secondToken, identity("google", "google-sub-b", "owner@example.com", null));
    expect((await socialLogin(app, "google", firstToken)).statusCode).toBe(200);

    const conflict = await socialLogin(app, "google", secondToken);

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("SOCIAL_ACCOUNT_CONFLICT");
    expect([...repositories.auth.users.values()][0]?.googleSubject).toBe("google-sub-a");
  });

  it("does not auto-link an existing account when Google is not authoritative for a third-party email", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "owner@third-party.example", password: "a-strong-password", displayName: "Owner" },
    });
    const token = "google-third-party-token-long-enough";
    identities.set(token, {
      ...identity("google", "google-third-party-sub", "owner@third-party.example", null),
      emailAuthoritative: false,
    });

    const response = await socialLogin(app, "google", token);

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("SOCIAL_ACCOUNT_CONFLICT");
    expect([...repositories.auth.users.values()][0]?.googleSubject).toBeNull();
  });

  it("rejects invalid tokens and identities without a verified email", async () => {
    const invalid = await socialLogin(app, "google", "invalid-token-that-is-long-enough");
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json().error.code).toBe("SOCIAL_TOKEN_INVALID");

    const unverifiedToken = "apple-id-token-unverified-long-enough";
    identities.set(unverifiedToken, { ...identity("apple", "apple-sub-2", "owner@example.com", null), emailVerified: false });
    const unverified = await socialLogin(app, "apple", unverifiedToken);
    expect(unverified.statusCode).toBe(401);
    expect(unverified.json().error.code).toBe("SOCIAL_EMAIL_UNVERIFIED");
    expect(repositories.auth.users.size).toBe(0);
  });
});

function identity(
  provider: "google" | "apple",
  subject: string,
  email: string,
  displayName: string | null,
): VerifiedSocialIdentity {
  return { provider, subject, email, displayName, emailVerified: true, emailAuthoritative: true };
}

function socialLogin(app: FastifyInstance, provider: "google" | "apple", idToken: string) {
  return app.inject({ method: "POST", url: "/v1/auth/social", payload: { provider, idToken } });
}
