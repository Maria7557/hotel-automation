import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createMonitor, describeRequest, signalCredentials } from "@hotel/monitoring";
import { traceRequest } from "@hotel/monitoring/request";
import { createApp } from "../src/app.js";
import { createMemoryRepositories } from "./helpers/memory-repositories.js";
import { monitoredProviderFetch } from "../src/monitoring/index.js";
import { createActionRunner } from "@hotel/monitoring/actions";
import { createMonitoringId } from "@hotel/monitoring";
import { DEMO_OFFER_PATH } from "@hotel/templates";

const env = { AUTH_SECRET: "monitoring-test-secret-at-least-32-characters", SESSION_TTL_DAYS: 30, corsOrigins: ["https://staff.example"] };
const open: FastifyInstance[] = [];
const monitors: ReturnType<typeof createMonitor>[] = [];
afterEach(async () => {
  await Promise.all(monitors.splice(0).map((monitor) => monitor.stop()));
  for (const app of open.splice(0).reverse()) await app.close();
});

async function fixture(configure?: (app: FastifyInstance) => void) {
  const uploads: any[] = [];
  const collector = Fastify();
  collector.post("/api/ingest", async (request) => { uploads.push(request.body); return {}; });
  open.push(collector);
  const endpoint = `${await collector.listen({ host: "127.0.0.1", port: 0 })}/api/ingest`;
  const app = await createApp({ env: { ...env, SIGNAL_ENDPOINT: endpoint, SIGNAL_WRITE_KEY_DEVELOPMENT: "test-development-only", SIGNAL_PUBLIC_WRITE_KEY_DEVELOPMENT: "test-public-only" }, repositories: createMemoryRepositories() });
  open.push(app);
  configure?.(app);
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  function client(userId?: string) {
    const monitor = createMonitor({ endpoint, token: "test-development-only", platform: "web", service: "ospio-test", persistSession: false });
    monitors.push(monitor);
    if (userId) monitor.identify(userId);
    return monitor;
  }
  return { app, origin, endpoint, uploads, client };
}

describe("Signal integration", () => {
  it("serves only the public key to widgets/offers and configures a narrow script/collector CSP", async () => {
    const f = await fixture();
    for (const path of ["/signal.js", "/embed.js"]) {
      const response = await f.app.inject(path);
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("test-public-only");
      expect(response.body).not.toContain("test-development-only");
    }
    const offer = await f.app.inject(DEMO_OFFER_PATH);
    expect(offer.body).toContain('src="/signal.js" data-signal-screen="Offer"');
    expect(offer.body).toContain("script-src 'self'");
    expect(offer.body).toContain(`connect-src ${new URL(f.endpoint).origin}`);
    expect(offer.body).not.toContain("script-src 'unsafe-inline'");
  });

  it("correlates normal HTML offer submissions from validated carriers without changing redirects", async () => {
    const f = await fixture(); const client = f.client("synthetic_guest"); await client.ready;
    client.screen("Offer", { pageUrl: "/public/Offer" });
    const scope = createActionRunner(client).run("public.offer.accept", "public.form.submit", (action) => action, "manual");
    const headers = client.getRequestHeaders({ ...scope.correlation, requestId: createMonitoringId() });
    const map = { "X-Signal-Session-Id": "_signalSessionId", "X-Signal-Context-Id": "_signalContextId", "X-Signal-View-Id": "_signalViewId", "X-Signal-Action-Id": "_signalActionId", "X-Signal-Request-Id": "_signalRequestId", "X-Signal-Trace-Id": "_signalTraceId", "X-Signal-Placement": "_signalPlacement" };
    const payload = new URLSearchParams({ option: "0", lang: "it", ...Object.fromEntries(Object.entries(map).map(([header, field]) => [field, headers[header as keyof typeof headers] ?? ""])) });
    const response = await f.app.inject({ method: "POST", url: `${DEMO_OFFER_PATH}/accept`, headers: { "content-type": "application/x-www-form-urlencoded" }, payload: payload.toString() });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toContain(`${DEMO_OFFER_PATH}?accepted=1&option=0`);
    await client.flush(); await f.app.signalMonitor!.flush();
    const events = f.uploads.flatMap((upload) => upload.events).filter((event) => event.sessionId === client.getContext().sessionId && event.platform === "server");
    expect(events.some((event) => event.name.startsWith("api.request.POST_"))).toBe(true);
    // A demo redirect is not an accepted booking.
    expect(events.some((event) => event.name === "offer.accept.completed")).toBe(false);
    expect(events.every((event) => event.actionId === scope.correlation.actionId)).toBe(true);
  });

  it("selects only the requested environment's key, disables invalid/missing configuration and requires production HTTPS", () => {
    const base = { endpoint: "https://monitor.example/api/ingest", developmentKey: "development", productionKey: "production" };
    expect(signalCredentials({ ...base, environment: "production" })?.token).toBe("production");
    expect(signalCredentials({ ...base, environment: "development" })?.token).toBe("development");
    expect(signalCredentials({ ...base, environment: "production", productionKey: "" })).toBeNull();
    expect(signalCredentials({ ...base, environment: "production", endpoint: "http://localhost/api/ingest" })).toBeNull();
    expect(signalCredentials({ ...base, environment: "development", endpoint: "https://user:password@example.test/api/ingest" })).toBeNull();
    expect(signalCredentials({ ...base, environment: undefined })).toBeNull();
  });

  it("uses constant templates and never includes raw IDs, queries or unmatched paths in labels", () => {
    expect(describeRequest("/v1/inquiries/PRIVATE_GUEST_ID/offers?token=SECRET")).toEqual({ route: "/v1/inquiries/:inquiryId/offers", requestName: "v1.inquiries.by_inquiryId.offers" });
    expect(describeRequest("/PRIVATE_GUEST_ID?password=SECRET")).toEqual({ route: "", requestName: "unmatched" });
    expect(describeRequest("/v1/clients/filter-options").route).toBe("/v1/clients/filter-options");
  });

  it("links anonymous navigation, login, actions, HTTP and logs while keeping private payloads out of telemetry", async () => {
    const f = await fixture(); const client = f.client(); await client.ready;
    client.screen("Authentication", { pageUrl: "/app/Authentication" });
    const sessionId = client.getContext().sessionId;
    const result = await traceRequest(client, "/v1/auth/register?token=PRIVATE_QUERY", "POST", "https://staff.example", async (headers, received) => {
      const response = await fetch(`${f.origin}/v1/auth/register?token=PRIVATE_QUERY`, { method: "POST", headers: { ...headers, "content-type": "application/json", origin: "https://staff.example" }, body: JSON.stringify({ email: "PRIVATE_EMAIL@example.test", password: "PRIVATE_PASSWORD", displayName: "Synthetic operator" }) });
      received(response.status); expect(response.status).toBe(201);
      return response.json() as Promise<{ data: { user: { id: string }; accessToken: string } }>;
    });
    client.identify(result.data.user.id, { companyId: "hotel_synthetic" });
    client.screen("Requests", { pageUrl: "/app/Requests" });
    await client.flush(); await f.app.signalMonitor!.flush();
    const events = f.uploads.flatMap((upload) => upload.events).filter((event) => event.sessionId === sessionId);
    const http = events.filter((event) => event.kind === "network");
    expect(new Set(http.map((event) => event.requestId)).size).toBe(1);
    expect(new Set(http.map((event) => event.traceId)).size).toBe(1);
    expect(new Set(http.map((event) => event.actionId)).size).toBe(1);
    expect(http.filter((event) => event.platform === "server")).toHaveLength(2);
    expect(http.every((event) => event.http.route === "/v1/auth/register")).toBe(true);
    expect(events.some((event) => event.name === "api.handler.completed")).toBe(true);
    expect(events.some((event) => event.name === "operation.POST.v1.auth.register.completed")).toBe(true);
    const contexts = f.uploads.flatMap((upload) => upload.contexts ?? []);
    expect(contexts.some((context) => context.sessionId === sessionId && !context.userId)).toBe(true);
    expect(contexts.some((context) => context.userId === result.data.user.id && context.companyId === "hotel_synthetic")).toBe(true);
    expect(events.some((event) => event.platform === "server" && event.userName === "Synthetic operator" && event.authState === "authenticated")).toBe(true);
    for (const secret of ["PRIVATE_QUERY", "PRIVATE_EMAIL", "PRIVATE_PASSWORD", result.data.accessToken]) expect(JSON.stringify(f.uploads)).not.toContain(secret);
    client.resetUser();
    expect(client.getContext().sessionId).not.toBe(sessionId);
    expect(client.getContext().userId).toBeUndefined();
    expect(client.getContext().companyId).toBeUndefined();
  });

  it("isolates concurrent sessions and correlates sanitized failures without replacing application errors", async () => {
    const f = await fixture(); const clients = [f.client("user_one"), f.client("user_two")];
    await Promise.all(clients.map((client) => client.ready));
    const originals = clients.map(() => new Error("PRIVATE_ERROR_VALUE"));
    await Promise.all(clients.map(async (client, index) => {
      client.screen("Requests", { pageUrl: "/app/Requests" });
      await expect(traceRequest(client, "/v1/inquiries/PRIVATE_ID", "GET", "https://staff.example", async (headers, received) => {
        const response = await fetch(`${f.origin}/v1/inquiries/PRIVATE_ID?token=PRIVATE_TOKEN`, { headers });
        received(response.status); expect(response.status).toBe(401);
        throw originals[index];
      })).rejects.toBe(originals[index]);
      await client.flush();
    }));
    await f.app.signalMonitor!.flush();
    const events = f.uploads.flatMap((upload) => upload.events);
    for (const client of clients) {
      const session = events.filter((event) => event.sessionId === client.getContext().sessionId);
      const requests = session.filter((event) => event.http);
      expect(new Set(requests.map((event) => event.requestId)).size).toBe(1);
      expect(session.some((event) => event.platform === "server")).toBe(true);
      expect(session.some((event) => event.level === "warning")).toBe(true);
    }
    for (const value of ["PRIVATE_ERROR_VALUE", "PRIVATE_ID", "PRIVATE_TOKEN"]) expect(JSON.stringify(f.uploads)).not.toContain(value);
  });

  it("preserves requests and return values with monitoring disabled or the collector offline", async () => {
    expect(await traceRequest(null, "/health", "GET", "", async (headers) => { expect(headers).toEqual({}); return 42; })).toBe(42);
    const app = await createApp({ env: { ...env, SIGNAL_ENDPOINT: "http://127.0.0.1:1/api/ingest", SIGNAL_WRITE_KEY_DEVELOPMENT: "offline-test" }, repositories: createMemoryRepositories() });
    open.push(app);
    const response = await app.inject("/health"); expect(response.statusCode).toBe(200);
    await app.signalMonitor!.flush();
    expect(app.signalMonitor!.pendingCount()).toBeGreaterThan(0);
    expect((await app.inject("/health")).statusCode).toBe(200);
  });

  it("does not read third-party payloads or propagate headers, and retains transport identity", async () => {
    const f = await fixture(); const response = new Response("original"); const init = { method: "POST", headers: { authorization: "PRIVATE_BEARER" }, body: "PRIVATE_BODY" };
    const wrapped = monitoredProviderFetch(f.app.signalMonitor, async (_input, supplied) => { expect(supplied).toBe(init); return response; }, "google");
    expect(await wrapped("https://provider.example/PRIVATE_PATH?token=PRIVATE_QUERY", init)).toBe(response);
    await f.app.signalMonitor!.flush();
    for (const secret of ["PRIVATE_BEARER", "PRIVATE_BODY", "PRIVATE_PATH", "PRIVATE_QUERY"]) expect(JSON.stringify(f.uploads)).not.toContain(secret);
  });

  it("keeps downstream provider correlation request-local across concurrent handlers", async () => {
    const f = await fixture((app) => {
      const provider = monitoredProviderFetch(app.signalMonitor, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response("ok");
      }, "synthetic");
      app.get("/synthetic-provider", async () => { await provider("https://provider.example/private"); return { ok: true }; });
    });
    const clients = [f.client("user_one"), f.client("user_two")];
    await Promise.all(clients.map((client) => client.ready));
    await Promise.all(clients.map((client) => traceRequest(client, "/synthetic-provider", "GET", "", async (headers, received) => {
      const response = await fetch(`${f.origin}/synthetic-provider`, { headers });
      received(response.status); return response;
    })));
    await Promise.all(clients.map((client) => client.flush()));
    await f.app.signalMonitor!.flush();
    const events = f.uploads.flatMap((upload) => upload.events);
    for (const client of clients) {
      const session = events.filter((event) => event.sessionId === client.getContext().sessionId);
      const provider = session.filter((event) => event.http?.requestName === "provider.synthetic");
      expect(provider).toHaveLength(2);
      expect(new Set(session.filter((event) => event.http).map((event) => event.traceId)).size).toBe(1);
      expect(new Set(provider.map((event) => event.requestId)).size).toBe(1);
    }
  });

  it("allows Signal correlation headers in first-party API CORS preflights", async () => {
    const f = await fixture();
    const headers = "x-signal-session-id,x-signal-context-id,x-signal-view-id,x-signal-request-id,x-signal-action-id,x-signal-trace-id,x-signal-placement,authorization,idempotency-key";
    const response = await f.app.inject({ method: "OPTIONS", url: "/v1/inquiries", headers: { origin: "https://staff.example", "access-control-request-method": "POST", "access-control-request-headers": headers } });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-headers"]).toBe(headers);
  });
});
