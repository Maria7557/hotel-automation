import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { safeError, safeLogFields, safeRequest, safeResponse } from "../src/safe-logging.js";
import { createMemoryRepositories } from "./helpers/memory-repositories.js";

describe("Ospio production compatibility", () => {
  const base = {
    DATABASE_URL: "postgres://fixture@localhost/test",
    AUTH_SECRET: "synthetic-auth-secret-at-least-32-characters",
  };

  it("keeps the old private production collector and canonical HTTPS home without reusing it in dev", () => {
    const source = { ...base, SIGNAL_WRITE_KEY: "legacy-fixture", PUBLIC_BASE_URL: "https://ospio.example" };
    const production = loadEnv({ ...source, NODE_ENV: "production" });
    expect(production.APP_BASE_URL).toBe("https://ospio.example");
    expect(production.SIGNAL_WRITE_KEY_PRODUCTION).toBe("legacy-fixture");
    expect(production.SIGNAL_PUBLIC_WRITE_KEY_PRODUCTION).toBeUndefined();
    expect(loadEnv(source).SIGNAL_WRITE_KEY_PRODUCTION).toBeUndefined();
    expect(loadEnv({ ...source, NODE_ENV: "production", SIGNAL_WRITE_KEY_PRODUCTION: "dedicated-fixture" }).SIGNAL_WRITE_KEY_PRODUCTION).toBe("dedicated-fixture");
    expect(() => loadEnv({ ...source, NODE_ENV: "production", PUBLIC_BASE_URL: "http://ospio.example" })).toThrow("APP_BASE_URL");
  });

  it("logs allowlisted status and call-site data without customer paths, payloads or errors", () => {
    const err = new Error("private-value");
    err.stack = "Error: private-value\n at x (/tmp/private-value/apps/server/src/app.ts:4:8)";
    const logs = [
      safeLogFields({ body: "private-value", account: "private-value", responseTime: 5 }),
      safeError(err),
      safeRequest({ method: "POST", url: "/private-value", headers: { authorization: "private-value" } }),
      safeResponse({ statusCode: 500, setCookie: "private-value" }),
    ];
    expect(JSON.stringify(logs)).not.toContain("private-value");
    expect(logs).toEqual([{ responseTime: 5 }, expect.objectContaining({ frames: [{ source: "src/app.ts", line: 4, column: 8 }] }), { method: "POST" }, { statusCode: 500 }]);
  });

  it("preserves authenticated UI diagnostics, rejects free text and limits event volume", async () => {
    const app = await createApp({ env: loadEnv(base), repositories: createMemoryRepositories() });
    try {
      const events = [{ name: "ui.screen.viewed", screen: "Requests" }];
      const url = "/v1/diagnostics";
      expect((await app.inject({ method: "POST", url, payload: { events } })).statusCode).toBe(401);
      const registration = await app.inject({ method: "POST", url: "/v1/auth/register", payload: {
        displayName: "Test staff", email: "staff@example.test", password: "fixture-password",
      } });
      expect(registration.statusCode).toBe(201);
      const headers = { authorization: `Bearer ${registration.json().data.accessToken}` };
      expect((await app.inject({ method: "POST", url, headers, payload: { events: [{ ...events[0], message: "private" }] } })).statusCode).toBe(400);
      const payload = { events: Array.from({ length: 5 }, () => events[0]) };
      for (const i of [0, 1]) {
        const res = await app.inject({ method: "POST", url, headers, payload });
        expect(res.statusCode, String(i)).toBe(202);
        expect(res.json()).toEqual({ accepted: 5 });
      }
      const limited = await app.inject({ method: "POST", url, headers, payload: { events } });
      expect(limited.statusCode).toBe(429);
      expect(limited.headers["retry-after"]).toBe("60");
    } finally {
      await app.close();
    }
  });
});
