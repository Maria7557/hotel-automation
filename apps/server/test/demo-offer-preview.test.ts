import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderDemoMessagePreview } from "../../mobile/src/api/demo-message-preview";
import { createApp } from "../src/app.js";
import { createMemoryRepositories, type MemoryRepositories } from "./helpers/memory-repositories.js";

describe("demo message offer links", () => {
  let app: FastifyInstance;
  let repositories: MemoryRepositories;

  beforeEach(async () => {
    repositories = createMemoryRepositories();
    app = await createApp({ env: {
      AUTH_SECRET: "demo-preview-test-secret-at-least-32-characters", SESSION_TTL_DAYS: 30, corsOrigins: [],
    }, repositories, logger: false });
  });
  afterEach(async () => app.close());

  it.each(["email", "whatsapp"] as const)("opens a real preview from the %s demo message", async (channel) => {
    const preview = renderDemoMessagePreview(channel, {
      emailSubjectTemplate: "Offerta da {{hotel_name}}",
      emailBodyTemplate: "{{guest_name}} · {{meal_plan}} · {{total}}\n{{offer_url}}",
      whatsappBodyTemplate: "{{guest_name}} · {{meal_plan}} · {{total}}\n{{offer_url}}",
    }, "http://localhost:4000");
    expect(preview.offer.url).toBe("http://localhost:4000/proposal/preview");
    expect(preview.text).toContain(preview.offer.url);
    expect(preview.text).toContain("Mario Rossi · BB · 240,00");
    const response = await app.inject({ method: "GET", url: new URL(preview.offer.url).pathname });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain(preview.offer.hotelName);
    for (const room of preview.offer.roomNames) expect(response.body).toContain(room);
    expect(response.body).toContain("Non verrà creata alcuna prenotazione reale");
    expect(response.body).toContain('action="/proposal/preview/accept"');
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });

  it("simulates acceptance without creating a booking or sending a message", async () => {
    const response = await app.inject({ method: "POST", url: "/proposal/preview/accept",
      headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "option=1" });
    expect(response.statusCode).toBe(303);
    const accepted = await app.inject({ method: "GET", url: response.headers.location! });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.body).toContain('id="confirmation-title"');
    expect(accepted.body).toContain("Mario Rossi");
    expect(accepted.body).toContain("Non verrà creata alcuna prenotazione reale");
    expect(accepted.body).not.toContain('<form method="post"');
    expect(repositories.automation.inquiries.size).toBe(0);
    expect(repositories.automation.offers.size).toBe(0);
    expect(repositories.automation.deliveries.size).toBe(0);
    expect((await app.inject({ method: "POST", url: "/proposal/preview/accept", payload: { option: 2 } })).statusCode).toBe(400);
  });
});
