import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/config/env.js";

describe("environment validation", () => {
  it("normalizes server configuration", () => {
    const env = loadEnv({
      DATABASE_URL: "postgres://hotel:hotel@localhost:5432/hotel",
      AUTH_SECRET: "a-secret-that-is-definitely-at-least-32-characters",
      CORS_ORIGINS: "https://one.example, https://two.example",
      PORT: "4100",
    });

    expect(env.PORT).toBe(4100);
    expect(env.corsOrigins).toEqual(["https://one.example", "https://two.example"]);
  });

  it("rejects a short auth secret", () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: "postgres://hotel:hotel@localhost:5432/hotel",
        AUTH_SECRET: "short",
      }),
    ).toThrow();
  });

  it("treats blank optional Google credentials as unconfigured", () => {
    const env = loadEnv({
      DATABASE_URL: "postgres://hotel:hotel@localhost:5432/hotel",
      AUTH_SECRET: "a-secret-that-is-definitely-at-least-32-characters",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      GOOGLE_REDIRECT_URI: "",
    });
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined();
    expect(env.GOOGLE_REDIRECT_URI).toBeUndefined();
    expect(env.DELIVERY_WORKER_ENABLED).toBe(false);
    expect(env.DELIVERY_WORKER_INTERVAL_MS).toBe(5_000);
  });
});
