import { createHash } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { createMemoryRepositories, type MemoryRepositories } from "./helpers/memory-repositories.js";

const origin = "https://hotel.example";
const testEnv = {
  AUTH_SECRET: "test-auth-secret-that-is-at-least-32-characters",
  SESSION_TTL_DAYS: 30,
  PUBLIC_BASE_URL: "https://offers.example",
  corsOrigins: ["http://localhost:8081"],
};

describe("public intake and proposal automation", () => {
  let app: FastifyInstance;
  let repositories: MemoryRepositories;

  beforeEach(async () => {
    repositories = createMemoryRepositories();
    app = await createApp({ env: testEnv, repositories, logger: false });
  });

  afterEach(async () => app.close());

  it("serves an embeddable form script and silently discards honeypot submissions", async () => {
    const script = await app.inject({ method: "GET", url: "/embed.js" });
    expect(script.statusCode).toBe(200);
    expect(script.headers["content-type"]).toContain("application/javascript");
    expect(script.headers["x-content-type-options"]).toBe("nosniff");
    expect(script.body).toContain("data-public-key");
    expect(script.body).toContain("Idempotency-Key");
    expect(script.body).toContain('script.dataset.mode === "adapter"');
    expect(script.body).toContain('formSelector = script.dataset.form || "[data-hotel-inquiry-form]"');
    expect(script.body).toContain('data-hotel-field="');
    expect(script.body).toContain('"existing_form"');
    expect(script.body).toContain('"embed"');
    expect(script.body).toContain("host.attachShadow");
    expect(() => new Function(script.body)).not.toThrow();

    const owner = await setupHotel(app, "honeypot@example.com", true);
    const trapped = await app.inject({
      method: "POST",
      url: `/v1/public/hotels/${owner.publicKey}/inquiries`,
      headers: { origin, "idempotency-key": "bot-submission" },
      payload: {
        guest: { name: "Bot", email: "bot@example.com", phone: null, language: "it" },
        checkIn: "2026-06-10",
        checkOut: "2026-06-12",
        occupancy: { adults: 2, childAges: [] },
        note: "",
        website: "https://spam.example",
        source: { type: "embed" },
      },
    });
    expect(trapped.statusCode).toBe(202);
    expect(repositories.automation.inquiries).toHaveLength(0);
  });

  it("keeps widget mode as the default and exposes selector mapping for an existing form", async () => {
    const script = await app.inject({ method: "GET", url: "/embed.js" });

    expect(script.statusCode).toBe(200);
    expect(script.body).toContain('data-mode="adapter"');
    expect(script.body).toContain("script.dataset.checkIn");
    expect(script.body).toContain("script.dataset.checkOut");
    expect(script.body).toContain("script.dataset.childAges");
    expect(script.body).toContain('[data-hotel-inquiry-status]');
    expect(script.body).toContain('form.dataset.hotelInquiryBound === "true"');
    expect(script.body).toContain('script.dataset.submitBehavior === "replace"');
    expect(script.body).toContain('keepalive: sourceType === "existing_form"');
    expect(script.body).toContain("{ capture: true }");

    const adapterBranch = script.body.indexOf('script.dataset.mode === "adapter"');
    const widgetCreation = script.body.indexOf('document.createElement("div")');
    expect(adapterBranch).toBeGreaterThan(0);
    expect(widgetCreation).toBeGreaterThan(adapterBranch);
  });

  it("captures an existing form submit and maps its fields without replacing the form", async () => {
    const response = await app.inject({ method: "GET", url: "/embed.js" });
    const fields: Record<string, { value: string; type?: string }> = {
      "#arrival": { value: "2026-08-10" },
      "#departure": { value: "2026-08-13" },
      "#guest": { value: "Giulia Bianchi" },
      "#mail": { value: "giulia@example.com" },
      "#phone": { value: "+393331112222" },
      "#adults": { value: "2" },
      "#ages": { value: "4, 9" },
      "#message": { value: "Late arrival" },
    };
    const submitButton = { disabled: false };
    const status = { dataset: {} as Record<string, string>, textContent: "" };
    let submitHandler: ((event: { preventDefault(): void; stopImmediatePropagation(): void }) => Promise<void>) | undefined;
    let listenerOptions: unknown;
    const dispatched: string[] = [];
    const form = {
      dataset: {} as Record<string, string>,
      querySelector(selector: string) {
        if (selector === "[data-hotel-inquiry-status]") return status;
        return fields[selector] ?? null;
      },
      querySelectorAll: () => [submitButton],
      addEventListener(_name: string, handler: typeof submitHandler, options: unknown) {
        submitHandler = handler;
        listenerOptions = options;
      },
      dispatchEvent(event: { type: string }) { dispatched.push(event.type); },
    };
    const script = {
      src: "https://api.example.com/embed.js",
      dataset: {
        publicKey: "11111111-1111-4111-8111-111111111111",
        mode: "adapter",
        form: "#booking-form",
        checkIn: "#arrival",
        checkOut: "#departure",
        name: "#guest",
        email: "#mail",
        phone: "#phone",
        adults: "#adults",
        childAges: "#ages",
        note: "#message",
      },
    };
    const documentStub = {
      currentScript: script,
      documentElement: { lang: "it" },
      querySelector: (selector: string) => selector === "#booking-form" ? form : null,
    };
    const requests: Array<{ url: string; init: { body: string; headers: Record<string, string> } }> = [];
    const fetchStub = async (url: string, init: { body: string; headers: Record<string, string> }) => {
      requests.push({ url, init });
      return { ok: true };
    };
    class CustomEventStub {
      constructor(public readonly type: string) {}
    }

    const run = new Function("document", "fetch", "crypto", "location", "CustomEvent", response.body);
    run(documentStub, fetchStub, { randomUUID: () => "request-id" }, { origin: origin, pathname: "/booking" }, CustomEventStub);

    expect(form.dataset.hotelInquiryBound).toBe("true");
    expect(listenerOptions).toEqual({ capture: true });
    expect(submitHandler).toBeTypeOf("function");
    let prevented = false;
    let propagationStopped = false;
    await submitHandler?.({
      preventDefault: () => { prevented = true; },
      stopImmediatePropagation: () => { propagationStopped = true; },
    });

    expect(prevented).toBe(false);
    expect(propagationStopped).toBe(false);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.example.com/v1/public/hotels/11111111-1111-4111-8111-111111111111/inquiries");
    expect(requests[0]?.init.headers["Idempotency-Key"]).toBe("request-id");
    expect(JSON.parse(requests[0]?.init.body ?? "{}")).toMatchObject({
      guest: { name: "Giulia Bianchi", email: "giulia@example.com", phone: "+393331112222", language: "it" },
      checkIn: "2026-08-10",
      checkOut: "2026-08-13",
      occupancy: { adults: 2, childAges: [4, 9] },
      note: "Late arrival",
      source: { type: "existing_form", page: "https://hotel.example/booking", widgetVersion: "v1" },
    });
    expect(submitButton.disabled).toBe(false);
    expect(status).toMatchObject({ dataset: { state: "success" }, textContent: "Request sent. You will receive our offer shortly." });
    expect(dispatched).toEqual(["hotel-inquiry:sending", "hotel-inquiry:success"]);
  });

  it("creates one immutable offer and fake deliveries without persisting the raw token", async () => {
    const owner = await setupHotel(app, "owner@example.com", true);
    const first = await intake(app, owner.publicKey, "same-request");
    expect(first.statusCode).toBe(202);
    expect(first.headers["access-control-allow-origin"]).toBe(origin);
    expect(first.json().data).toMatchObject({ automated: true, deliveriesScheduled: 2, replayed: false });

    const proposalUrl = first.json().data.proposalUrl as string;
    const rawToken = proposalUrl.split("/").at(-1) as string;
    expect(rawToken).toBeTruthy();
    expect(repositories.automation.inquiries).toHaveLength(1);
    expect(repositories.automation.offers).toHaveLength(1);
    expect(repositories.automation.deliveries).toHaveLength(2);
    expect(JSON.stringify([...repositories.automation.offers.values()])).not.toContain(rawToken);
    expect(JSON.stringify([...repositories.automation.deliveries.values()])).not.toContain(rawToken);
    expect([...repositories.automation.offers.values()][0]?.publicTokenHash).toBe(
      createHash("sha256").update(rawToken).digest("hex"),
    );

    const initialDashboard = await app.inject({
      method: "GET",
      url: "/v1/dashboard",
      headers: auth(owner.token),
    });
    expect(initialDashboard.statusCode).toBe(200);
    expect(initialDashboard.json().data.inquiries[0]).toMatchObject({
      id: first.json().data.inquiryId,
      guestName: "Mario Rossi",
      checkIn: "2026-06-10",
      checkOut: "2026-06-12",
      occupancy: { adults: 2, childAges: [] },
      offerSummary: { roomName: "Camera Deluxe", totalCents: 20_000, currency: "EUR" },
      channelStates: { email: "scheduled", whatsapp: "scheduled" },
      workflowState: "new",
      attentionReason: null,
    });
    expect(initialDashboard.json().data.inquiries[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    for (const delivery of repositories.automation.deliveries.values()) {
      repositories.automation.deliveries.set(delivery.id, {
        ...delivery,
        state: delivery.channel === "email" ? "delivered" : "failed",
        updatedAt: new Date(),
      });
    }
    const deliveredDashboard = await app.inject({
      method: "GET",
      url: "/v1/dashboard",
      headers: auth(owner.token),
    });
    expect(deliveredDashboard.json().data.inquiries[0]).toMatchObject({
      channelStates: { email: "delivered", whatsapp: "failed" },
      workflowState: "offer_sent",
    });

    const replay = await intake(app, owner.publicKey, "same-request");
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data).toMatchObject({
      inquiryId: first.json().data.inquiryId,
      replayed: true,
      deliveriesScheduled: 2,
    });
    expect(replay.json().data.proposalUrl).toBeUndefined();
    expect(repositories.automation.inquiries).toHaveLength(1);

    const read = await app.inject({ method: "GET", url: `/v1/public/offers/${rawToken}` });
    expect(read.statusCode).toBe(200);
    expect(read.json().data.offer).toMatchObject({ state: "active", acceptedAt: null });

    const page = await app.inject({ method: "GET", url: `/proposal/${rawToken}` });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.headers["cache-control"]).toBe("private, no-store");
    expect(page.headers["x-robots-tag"]).toContain("noindex");
    expect(page.body).toContain(`<form method="post" action="/proposal/${rawToken}/accept"`);
    expect((page.body.match(/<form\b/g) ?? [])).toHaveLength(1);

    const invalidOption = await app.inject({
      method: "POST",
      url: `/v1/public/offers/${rawToken}/accept`,
      payload: { option: 99 },
    });
    expect(invalidOption.statusCode).toBe(422);
    expect(invalidOption.json().error.code).toBe("INVALID_OFFER_OPTION");

    const accepted = await app.inject({
      method: "POST",
      url: `/proposal/${rawToken}/accept`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "option=0",
    });
    expect(accepted.statusCode).toBe(303);
    expect(accepted.headers.location).toBe(`/proposal/${rawToken}`);
    const acceptedOffer = await app.inject({ method: "GET", url: `/v1/public/offers/${rawToken}` });
    const acceptedAt = acceptedOffer.json().data.offer.acceptedAt;
    expect(acceptedOffer.json().data.offer).toMatchObject({
      state: "accepted",
      selectedOptionIndex: 0,
    });
    const repeated = await app.inject({ method: "POST", url: `/v1/public/offers/${rawToken}/accept` });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().data.offer).toMatchObject({ state: "accepted", acceptedAt, selectedOptionIndex: 0 });

    const acceptedDashboard = await app.inject({
      method: "GET",
      url: "/v1/dashboard",
      headers: auth(owner.token),
    });
    expect(acceptedDashboard.json().data).toMatchObject({
      counts: { requiresConfirmation: 1 },
      inquiries: [{ workflowState: "requires_confirmation" }],
    });

    const markedSent = await app.inject({
      method: "POST",
      url: `/v1/inquiries/${first.json().data.inquiryId}/payment-link-sent`,
      headers: auth(owner.token),
    });
    expect(markedSent.statusCode).toBe(200);
    expect(markedSent.json().data).toMatchObject({ inquiryId: first.json().data.inquiryId });
    expect(markedSent.json().data.paymentLinkSentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const completedDashboard = await app.inject({
      method: "GET",
      url: "/v1/dashboard",
      headers: auth(owner.token),
    });
    expect(completedDashboard.json().data).toMatchObject({
      counts: { requiresConfirmation: 0 },
      inquiries: [{ workflowState: "payment_link_sent" }],
    });

    const acceptedPage = await app.inject({ method: "GET", url: `/proposal/${rawToken}` });
    expect(acceptedPage.statusCode).toBe(200);
    expect(acceptedPage.body).not.toContain("<form");
    expect(acceptedPage.body).toContain('class="status accepted"');

    const noGetAccept = await app.inject({ method: "GET", url: `/v1/public/offers/${rawToken}/accept` });
    expect(noGetAccept.statusCode).toBe(404);
  });

  it("enforces the origin allowlist and stores a gap for manual attention without prices", async () => {
    const owner = await setupHotel(app, "owner@example.com", false);
    const denied = await intake(app, owner.publicKey, "denied", "https://evil.example");
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("ORIGIN_NOT_ALLOWED");

    const gap = await intake(app, owner.publicKey, "gap");
    expect(gap.statusCode).toBe(202);
    expect(gap.json().data).toMatchObject({ automated: false, attentionReason: "missing_rate" });
    expect(repositories.automation.offers).toHaveLength(0);
    expect(repositories.automation.deliveries).toHaveLength(0);
    expect(JSON.stringify([...repositories.automation.inquiries.values()])).not.toContain("totalCents");

    const dashboard = await app.inject({ method: "GET", url: "/v1/dashboard", headers: auth(owner.token) });
    expect(dashboard.json().data.inquiries[0]).toMatchObject({
      occupancy: { adults: 2, childAges: [] },
      offerSummary: null,
      channelStates: { email: null, whatsapp: null },
      workflowState: "needs_attention",
      attentionReason: "missing_rate",
    });
  });

  it("blocks expired and revoked offers and isolates tenant dashboards", async () => {
    const owner = await setupHotel(app, "owner@example.com", true);
    const other = await setupHotel(app, "other@example.com", true);
    const response = await intake(app, owner.publicKey, "owner-intake");
    const rawToken = (response.json().data.proposalUrl as string).split("/").at(-1) as string;
    const [offer] = repositories.automation.offers.values();
    if (!offer) throw new Error("expected offer");
    repositories.automation.offers.set(offer.id, { ...offer, expiresAt: new Date(0) });
    const expired = await app.inject({ method: "POST", url: `/v1/public/offers/${rawToken}/accept` });
    expect(expired.statusCode).toBe(410);
    expect(expired.json().error.code).toBe("OFFER_EXPIRED");

    repositories.automation.offers.set(offer.id, { ...offer, state: "revoked", revokedAt: new Date() });
    const revoked = await app.inject({ method: "GET", url: `/v1/public/offers/${rawToken}` });
    expect(revoked.statusCode).toBe(410);
    expect(revoked.json().error.code).toBe("OFFER_REVOKED");

    const ownerDashboard = await app.inject({ method: "GET", url: "/v1/dashboard", headers: auth(owner.token) });
    expect(ownerDashboard.json().data.counts.total).toBe(1);
    const otherDashboard = await app.inject({ method: "GET", url: "/v1/dashboard", headers: auth(other.token) });
    expect(otherDashboard.json().data.counts.total).toBe(0);
  });
});

async function setupHotel(app: FastifyInstance, email: string, withRate: boolean) {
  const registration = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: "a-strong-password", displayName: "Owner" },
  });
  const token = registration.json().data.accessToken as string;
  const created = await app.inject({
    method: "POST",
    url: "/v1/hotel",
    headers: auth(token),
    payload: { name: `Hotel ${email}`, city: "Firenze" },
  });
  const hotel = created.json().data.hotel;
  await app.inject({
    method: "PUT",
    url: "/v1/hotel/intake-settings",
    headers: auth(token),
    payload: { allowedOrigins: [origin] },
  });
  const room = await app.inject({
    method: "POST",
    url: "/v1/rooms",
    headers: auth(token),
    payload: {
      name: "Camera Deluxe",
      maxAdults: 2,
      maxChildren: 1,
      maxGuests: 3,
      beds: [{ type: "king", count: 1 }],
      amenities: ["wifi"],
      photoUrls: [],
    },
  });
  if (withRate) {
    await app.inject({
      method: "POST",
      url: `/v1/rooms/${room.json().data.room.id}/rates`,
      headers: auth(token),
      payload: {
        planCode: "breakfast",
        planName: "Breakfast included",
        mealPlan: "breakfast",
        start: "2026-01-01",
        endInclusive: "2026-12-31",
        nightlyBaseCents: 10_000,
        includedAdults: 2,
        includedChildren: 0,
        extraAdultCents: 3_000,
        extraChildCents: 1_500,
        maxChildAge: 12,
        minNights: 1,
      },
    });
  }
  return { token, publicKey: hotel.publicKey as string };
}

function intake(app: FastifyInstance, publicKey: string, key: string, requestOrigin = origin) {
  return app.inject({
    method: "POST",
    url: `/v1/public/hotels/${publicKey}/inquiries`,
    headers: { origin: requestOrigin, "idempotency-key": key },
    payload: {
      guest: { name: "Mario Rossi", email: "mario@example.com", phone: "+393331234567", language: "it" },
      checkIn: "2026-06-10",
      checkOut: "2026-06-12",
      occupancy: { adults: 2, childAges: [] },
      note: "Late arrival",
      source: { widgetVersion: "v1" },
    },
  });
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
