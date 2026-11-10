import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { ClientRepository } from "../src/repositories/clients.js";
import { createMemoryRepositories } from "./helpers/memory-repositories.js";

describe("client guest language", () => {
  it.each([undefined, "en-GB"])("defaults to Italian while preserving an explicit language (%s)", async (locale) => {
    const create = vi.fn<ClientRepository["create"]>(async (_userId, input) => ({
      client: { ...input, id: randomUUID(), source: "manual", firstInquiryAt: null,
        lastInquiryAt: null, createdAt: new Date().toISOString(), requestCount: 0 },
      created: true,
    }));
    const unused = async (): Promise<never> => { throw new Error("Unexpected contact operation"); };
    const clients: ClientRepository = { create, find: unused, list: unused, filterOptions: unused,
      statuses: unused, addFromInquiry: unused, history: unused };
    const app = await createApp({
      env: { AUTH_SECRET: "guest-language-test-secret-at-least-32-characters", SESSION_TTL_DAYS: 30,
        PUBLIC_BASE_URL: "https://offers.example", corsOrigins: [] },
      repositories: createMemoryRepositories(), clients, logger: false,
    });
    try {
      const registration = await app.inject({ method: "POST", url: "/v1/auth/register",
        payload: { email: "guest-language@example.com", password: "a-strong-password", displayName: "Owner" } });
      expect(registration.statusCode).toBe(201);
      const response = await app.inject({ method: "POST", url: "/v1/clients",
        headers: { authorization: `Bearer ${registration.json().data.accessToken}` },
        payload: { name: "Anna", email: "anna@example.com", ...(locale ? { locale } : {}) } });
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json().data.client.locale).toBe(locale ?? "it");
      expect(create).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ locale: locale ?? "it" }));
    } finally {
      await app.close();
    }
  });
});
