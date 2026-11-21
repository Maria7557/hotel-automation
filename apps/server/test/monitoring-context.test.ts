import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { createMonitor, createMonitoringId, monitoringError } from "@hotel/monitoring";
import { createActionRunner } from "@hotel/monitoring/actions";
import { traceRequest } from "@hotel/monitoring/request";
import { createApp } from "../src/app.js";
import { createMemoryRepositories } from "./helpers/memory-repositories.js";
import { AppError } from "../src/lib/errors.js";
import { monitoringScope } from "../src/monitoring/scope.js";
import { monitoredService } from "../src/monitoring/workflows.js";
import { ClientWorker } from "../src/services/client-worker.js";

const monitors: ReturnType<typeof createMonitor>[] = [];
afterEach(async () => {
  await Promise.all(monitors.splice(0).map((monitor) => monitor.stop()));
  vi.useRealTimers(); vi.resetModules();
});
function fixture(platform: "web" | "server" = "web", transport?: typeof fetch) {
  const uploads: any[] = []; const diagnostics: string[] = [];
  const monitor = createMonitor({ endpoint: "https://collector.example/api/ingest", token: "synthetic-only", platform,
    service: platform === "server" ? "ospio-worker-test" : "ospio-web-test", serviceVersion: "test-release", persistSession: false, batchSize: 100, flushIntervalMs: 60_000,
    onDiagnostic: ({ reason }) => diagnostics.push(reason),
    fetch: transport ?? (async (_input, init) => { uploads.push(JSON.parse(String(init?.body))); return Response.json({}); }) });
  monitors.push(monitor);
  return { monitor, uploads, diagnostics, events: () => uploads.flatMap((upload) => upload.events), contexts: () => uploads.flatMap((upload) => upload.contexts ?? []) };
}

describe("event-time monitoring context", () => {
  it("keeps a pending workflow and its HTTP response on the original user, hotel and view after logout", async () => {
    const f = fixture(); await f.monitor.ready;
    f.monitor.identify("operator-a", { userName: "Operator A", companyId: "hotel-a", companyName: "Hotel A" });
    f.monitor.screen("Requests", { pageUrl: "/app/Requests" });
    const original = f.monitor.getContext();
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const actions = createActionRunner(f.monitor);
    const result = actions.run("reservation.save", "Reservation.save", async (scope) => {
      await traceRequest(f.monitor, "/v1/inquiries", "POST", "https://staff.example", async (_headers, received) => {
        await gate; received(201); return 42;
      }, scope);
      await traceRequest(f.monitor, "/v1/dashboard", "GET", "https://staff.example", async (_headers, received) => { received(200); return 42; }, scope);
    });
    f.monitor.resetUser();
    expect(f.monitor.getContext().sessionNumber).toBe(2);
    f.monitor.identify("operator-b", { userName: "Operator B", companyId: "hotel-b", companyName: "Hotel B" });
    f.monitor.screen("Clients", { pageUrl: "/app/Clients" });
    release(); await result; await f.monitor.flush();
    const events = f.events().filter((event) => event.actionId);
    expect(new Set(events.map((event) => event.sessionId))).toEqual(new Set([original.sessionId]));
    expect(new Set(events.map((event) => event.viewId))).toEqual(new Set([original.viewId]));
    const snapshots = new Map(f.contexts().map((context) => [context.id, context]));
    for (const event of events) expect(snapshots.get(event.contextId)).toMatchObject({ userId: "operator-a", companyId: "hotel-a", userName: "Operator A", authState: "authenticated" });
    expect(new Set(events.filter((event) => event.http).map((event) => event.requestId)).size).toBe(2);
    expect(new Set(events.map((event) => event.emitterId)).size).toBe(1);
    expect(events.every((event) => event.sdkVersion === "0.3.0" && Number.isInteger(event.sequence) && event.sequence > 0)).toBe(true);
  });

  it("rejects late identity updates from an old session and clears both names on account switching", async () => {
    const f = fixture(); await f.monitor.ready;
    vi.doMock("../../mobile/src/monitoring", () => ({ monitor: f.monitor }));
    const modulePath = new URL("../../mobile/src/monitoring/identity.ts", import.meta.url).pathname;
    const identity = await import(modulePath);
    identity.identifyMonitoringUser({ id: "operator-a", displayName: "Operator A" });
    identity.identifyMonitoringHotel({ id: "hotel-a", name: "Hotel A" });
    const old = f.monitor.getContext();
    identity.identifyMonitoringUser({ id: "operator-b", displayName: "Operator B" });
    expect(f.monitor.getContext()).toMatchObject({ userId: "operator-b", userName: "Operator B", companyId: "", companyName: "" });
    expect(f.monitor.getContext().sessionId).not.toBe(old.sessionId);
    identity.identifyMonitoringHotel({ id: "hotel-a", name: "Hotel A" }, old);
    identity.identifyMonitoringUser({ id: "operator-a", displayName: "Operator A" }, old);
    identity.clearMonitoringUser(old);
    expect(f.monitor.getContext()).toMatchObject({ userId: "operator-b", companyId: "" });
    identity.clearMonitoringUser();
    expect(f.monitor.getContext()).toMatchObject({ authState: "anonymous", sessionNumber: 3 });
    expect(f.monitor.getContext().userName).toBeUndefined();
    expect(f.monitor.getContext().companyName).toBeUndefined();
  });

  it("uses authenticated tenant context rather than the client's claimed account for concurrent API requests", async () => {
    const uploads: any[] = [];
    const collector = Fastify();
    collector.post("/api/ingest", async (request) => { uploads.push(request.body); return {}; });
    const endpoint = `${await collector.listen({ host: "127.0.0.1", port: 0 })}/api/ingest`;
    const repositories = createMemoryRepositories();
    const app = await createApp({ env: { AUTH_SECRET: "synthetic-auth-secret-at-least-32-characters", SESSION_TTL_DAYS: 30, corsOrigins: [],
      SIGNAL_ENDPOINT: endpoint, SIGNAL_WRITE_KEY_DEVELOPMENT: "synthetic" }, repositories });
    try {
      const accounts = await Promise.all(["A", "B"].map(async (suffix) => {
        const response = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { displayName: `Operator ${suffix}`, email: `private-${suffix}@example.test`, password: "PRIVATE_PASSWORD" } });
        expect(response.statusCode).toBe(201);
        const { accessToken, user } = response.json().data;
        const hotel = await app.inject({ method: "POST", url: "/v1/hotel", headers: { authorization: `Bearer ${accessToken}` }, payload: { name: `Hotel ${suffix}`, city: "Roma" } });
        expect(hotel.statusCode).toBe(201);
        return { accessToken, user, hotel: hotel.json().data.hotel, requestId: createMonitoringId(), sessionId: createMonitoringId() };
      }));
      await Promise.all(accounts.map(async (account) => {
        const response = await app.inject({ url: "/v1/hotel", headers: { authorization: `Bearer ${account.accessToken}`, "x-signal-session-id": account.sessionId, "x-signal-context-id": createMonitoringId(), "x-signal-request-id": account.requestId } });
        expect(response.statusCode).toBe(200);
      }));
      const unknownId = createMonitoringId();
      expect((await app.inject({ url: "/v1/hotel", headers: { "x-signal-session-id": accounts[0]!.sessionId, "x-signal-context-id": createMonitoringId(), "x-signal-request-id": unknownId } })).statusCode).toBe(401);
      await app.signalMonitor!.flush();
      const events = uploads.flatMap((upload) => upload.events);
      for (const account of accounts) expect(events.find((event) => event.requestId === account.requestId && event.name.startsWith("api.response."))).toMatchObject({
        userId: account.user.id, userName: account.user.displayName, companyId: account.hotel.id, companyName: account.hotel.name, authState: "authenticated", identityOverride: true,
      });
      expect(events.find((event) => event.requestId === unknownId && event.name.startsWith("api.response."))).toMatchObject({ userId: "", companyId: "", authState: "unknown", identityOverride: true });
      expect(JSON.stringify(uploads)).not.toContain("PRIVATE_PASSWORD");
    } finally { await app.close(); await collector.close(); }
  });

  it("keeps known rejection codes and source locations without exception text or local paths", () => {
    const original = new AppError(410, "OFFER_EXPIRED", "PRIVATE_GUEST token=PRIVATE_TOKEN");
    original.stack = "AppError: PRIVATE_GUEST\n    at PRIVATE_FUNCTION (/Users/PRIVATE_HOME/work/hotel-automation/apps/server/src/services/automation.ts:360:18)\n    at PRIVATE_GUEST (https://private.example/proposal/PRIVATE_TOKEN:1:2)";
    const safe = monitoringError(original);
    expect(safe.name).toBe("AppError");
    expect(safe.message).toContain("OFFER_EXPIRED");
    expect(safe.stack).toContain("apps/server/src/services/automation.ts:360:18");
    expect(JSON.stringify({ message: safe.message, stack: safe.stack })).not.toContain("PRIVATE_");
    expect(original.message).toContain("PRIVATE_GUEST");
  });

  it("records business rejection even when a handler catches the error and returns a redirect", async () => {
    const f = fixture("server"); await f.monitor.ready;
    const original = new AppError(410, "OFFER_EXPIRED", "private value");
    const service = monitoredService(f.monitor, { async accept() { throw original; } }, { accept: "offer.accept" }, "automation");
    const context = { sessionId: createMonitoringId(), actionId: createMonitoringId(), traceId: createMonitoringId(), companyId: "hotel-a" };
    await monitoringScope.run(context, async () => {
      try { await service.accept(); } catch (error) { expect(error).toBe(original); }
    });
    await f.monitor.flush();
    expect(f.events().map((event) => event.name)).toEqual(["offer.accept.started", "offer.accept.rejected"]);
    expect(f.events()[1]).toMatchObject({ actionId: context.actionId, traceId: context.traceId, attributes: { failureCode: "OFFER_EXPIRED", failedStep: "automation.accept" } });
  });

  it("records worker retry and completion without interpreting a caught error as success", async () => {
    const f = fixture("server"); await f.monitor.ready;
    const logger = { info: vi.fn(), error: vi.fn() };
    const repository = { nextHotel: async () => "hotel-a", pending: async () => ["job-a", "job-b"],
      syncInquiry: async (_hotel: string, job: string) => { if (job === "job-a") throw new AppError(409, "CLIENT_IDENTITY_CONFLICT", "PRIVATE_GUEST"); }, recordFailure: vi.fn().mockResolvedValue(undefined) };
    expect(await new ClientWorker(repository, logger, 25, f.monitor).processBatch()).toBe(1);
    await f.monitor.flush();
    expect(f.events().filter((event) => event.attributes.jobId === "job-a").map((event) => event.name)).toEqual(["contact.sync.started", "contact.sync.retry"]);
    expect(f.events().filter((event) => event.attributes.jobId === "job-b").map((event) => event.name)).toEqual(["contact.sync.started", "contact.sync.completed"]);
    expect(f.events().every((event) => event.source === "worker" && event.sessionKind === "process")).toBe(true);
    expect(JSON.stringify(f.uploads)).not.toContain("PRIVATE_GUEST");
  });

  it("reports rejection, missing registrations and collector filtering, while retaining event IDs on retry", async () => {
    vi.useFakeTimers();
    const attempts: any[] = []; let offline = true;
    const f = fixture("web", async (_url, init) => {
      attempts.push(JSON.parse(String(init?.body)));
      if (offline) throw new Error("offline");
      return Response.json({ filtered: 1, missingContexts: ["unregistered"], missingViews: ["unregistered"], diagnostics: ["Sampling enabled"] });
    });
    await f.monitor.ready; f.monitor.info("test.event"); await f.monitor.flush();
    expect(f.monitor.pendingCount()).toBe(1);
    offline = false; await vi.advanceTimersByTimeAsync(5000); await f.monitor.flush();
    expect(attempts[0].events[0].id).toBe(attempts[1].events[0].id);
    expect(f.diagnostics).toContain("Collector reported missing context registrations");
    expect(f.diagnostics).toContain("Collector reported missing view registrations");
    expect(f.diagnostics).toContain("Collector policy filtered events");
    expect(f.diagnostics).toContain("Sampling enabled");
  });
});
