import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { createMemoryRepositories } from "./helpers/memory-repositories.js";

describe("image media", () => {
  let app: FastifyInstance;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "hotel-media-"));
    process.env.UPLOADS_DIRECTORY = directory;
    app = await createApp({
      env: {
        AUTH_SECRET: "test-auth-secret-that-is-at-least-32-characters",
        SESSION_TTL_DAYS: 30,
        corsOrigins: ["http://localhost:8081"],
        PUBLIC_BASE_URL: "https://api.example.test",
      },
      repositories: createMemoryRepositories(),
      logger: false,
    });
  });

  afterEach(async () => {
    await app.close();
    delete process.env.UPLOADS_DIRECTORY;
    await rm(directory, { recursive: true, force: true });
  });

  it("stores an authenticated PNG and serves it from its public URL", async () => {
    const registration = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "owner@example.com", password: "a-strong-password", displayName: "Owner" },
    });
    const token = registration.json().data.accessToken as string;
    const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    const upload = await app.inject({
      method: "POST",
      url: "/v1/media/images",
      headers: { authorization: `Bearer ${token}` },
      payload: { base64, mimeType: "image/png" },
    });

    expect(upload.statusCode).toBe(201);
    const publicUrl = new URL(upload.json().data.url as string);
    expect(publicUrl.origin).toBe("https://api.example.test");
    const image = await app.inject({ method: "GET", url: publicUrl.pathname });
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toContain("image/png");
    expect(image.rawPayload.subarray(0, 8).toString("base64")).toBe(Buffer.from(base64, "base64").subarray(0, 8).toString("base64"));
  });

  it("requires authentication and rejects content that does not match the declared image type", async () => {
    const unauthorized = await app.inject({
      method: "POST",
      url: "/v1/media/images",
      payload: { base64: Buffer.from("not an image").toString("base64"), mimeType: "image/png" },
    });
    expect(unauthorized.statusCode).toBe(401);

    const registration = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "owner@example.com", password: "a-strong-password", displayName: "Owner" },
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/media/images",
      headers: { authorization: `Bearer ${registration.json().data.accessToken as string}` },
      payload: { base64: Buffer.from("not an image").toString("base64"), mimeType: "image/png" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("INVALID_IMAGE");
  });
});
