import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createMonitor } from "@hotel/monitoring";
import { traceRequest } from "@hotel/monitoring/request";
import { createActionRunner, type ActionScope } from "@hotel/monitoring/actions";
import { createApp } from "../src/app.js";
import { createMemoryRepositories } from "../test/helpers/memory-repositories.js";

// Uses the actual updated collector and a disposable database. Never loads .env.
const source = process.argv[2];
if (!source) throw new Error("Usage: npm run monitoring:smoke -- /absolute/path/to/Monitoring");
const { Store } = await import(pathToFileURL(resolve(source, "server/store.ts")).href);
const { createApp: createCollector } = await import(pathToFileURL(resolve(source, "server/app.ts")).href);
const dir = await mkdtemp(join(tmpdir(), "ospio-signal-smoke-"));
const store = new Store(join(dir, "signal.sqlite"));
const project = store.createProject("Ospio synthetic integration");
const development = store.createKey(project.id, "development");
const production = store.createKey(project.id, "production");
const collector = await createCollector({ store, password: "synthetic-disposable-password", retention: false });
const endpoint = `${await collector.listen({ host: "127.0.0.1", port: 0 })}/api/ingest`;
const app = await createApp({ env: { AUTH_SECRET: "synthetic-smoke-auth-secret-at-least-32-characters", SESSION_TTL_DAYS: 30, corsOrigins: [],
  SIGNAL_ENDPOINT: endpoint, SIGNAL_WRITE_KEY_DEVELOPMENT: development }, repositories: createMemoryRepositories() });
const origin = await app.listen({ host: "127.0.0.1", port: 0 });
const diagnostics: string[] = [];
const client = createMonitor({ endpoint, token: development, platform: "web", service: "ospio-web", serviceVersion: "synthetic-web-release", persistSession: false, onDiagnostic: ({ reason }) => diagnostics.push(reason) });
const other = createMonitor({ endpoint, token: development, platform: "ios", service: "ospio-ios", serviceVersion: "synthetic-native-release" });
const isolated = createMonitor({ endpoint, token: production, platform: "server", service: "ospio-production-test", serviceVersion: "synthetic-release" });
try {
  await Promise.all([client.ready, other.ready, isolated.ready]);
  client.session("session.started", { placement: "app.bootstrap" });
  client.screen("Authentication", { pageUrl: "/app/Authentication" });
  const sessionId = client.getContext().sessionId!;
  const accounts = await Promise.all(["A", "B"].map(async (suffix) => {
    const registered = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: `private-${suffix}@example.test`, password: "PRIVATE_PASSWORD", displayName: `Synthetic operator ${suffix}` } });
    assert.equal(registered.statusCode, 201);
    const { user, accessToken } = registered.json().data;
    const created = await app.inject({ method: "POST", url: "/v1/hotel", headers: { authorization: `Bearer ${accessToken}` }, payload: { name: `Synthetic hotel ${suffix}`, city: "Roma" } });
    assert.equal(created.statusCode, 201);
    return { user, accessToken, hotel: created.json().data.hotel };
  }));
  client.identify(accounts[0]!.user.id, { userName: accounts[0]!.user.displayName, companyId: accounts[0]!.hotel.id, companyName: accounts[0]!.hotel.name });
  client.screen("Requests", { pageUrl: "/app/Requests" });
  other.identify(accounts[1]!.user.id, { userName: accounts[1]!.user.displayName, companyId: accounts[1]!.hotel.id, companyName: accounts[1]!.hotel.name });
  other.screen("Clients");
  await Promise.all([client, other].map((monitor, index) => traceRequest(monitor, "/v1/hotel?token=PRIVATE_QUERY", "GET", "https://staff.example", async (headers, received) => {
    const response = await fetch(`${origin}/v1/hotel?token=PRIVATE_QUERY`, { headers: { ...headers, authorization: `Bearer ${accounts[index]!.accessToken}` } });
    received(response.status); assert.equal(response.status, 200); return response;
  })));
  const failure = new Error("PRIVATE_ERROR");
  await assert.rejects(traceRequest(client, "/v1/inquiries/PRIVATE_PATH", "POST", "https://staff.example", async (headers, received) => {
    const response = await fetch(`${origin}/v1/inquiries/PRIVATE_PATH?password=PRIVATE_QUERY`, { method: "POST", headers, body: "PRIVATE_BODY" });
    received(response.status); throw failure;
  }), (error) => error === failure);
  for (let i = 0; i < 110; i++) client.info("synthetic.processing.completed", { placement: "smoke.run", attributes: { count: i, password: "PRIVATE_NESTED" } });
  client.warn("synthetic.processing.warning", { placement: "smoke.run" });
  isolated.info("synthetic.production.isolated", { sessionId });
  await Promise.all([client.flush(), other.flush(), isolated.flush(), app.signalMonitor!.flush()]);
  assert.deepEqual(diagnostics, []);
  const first = store.session(project.id, "development", sessionId, undefined, 100);
  assert.ok(first); assert.equal(first.events.length, 100); assert.ok(first.nextCursor);
  const second = store.session(project.id, "development", sessionId, first.nextCursor, 100);
  const events = [...first.events, ...second.events];
  assert.equal(new Set(events.map((event: any) => event.id)).size, first.session.events);
  assert.ok(events.some((event: any) => event.platform === "server" && event.screen === "Requests" && event.user_id === accounts[0]!.user.id && event.company_id === accounts[0]!.hotel.id && event.user_name === accounts[0]!.user.displayName && event.company_name === accounts[0]!.hotel.name));
  assert.ok(events.some((event: any) => event.kind === "error"));
  assert.ok(events.some((event: any) => event.level === "warning"));
  assert.ok(events.some((event: any) => !event.user_id));
  assert.ok(events.every((event: any) => event.user_id !== accounts[1]!.user.id));
  const network = events.filter((event: any) => event.kind === "network" && event.http?.route === "/v1/hotel");
  assert.equal(network.length, 4);
  assert.equal(new Set(network.map((event: any) => event.request_id)).size, 1);
  assert.equal(new Set(network.map((event: any) => event.trace_id)).size, 1);
  assert.equal(store.session(project.id, "production", sessionId).session.events, 1);
  const details = events.map((event: any) => store.event(event.row_id));
  const serialized = JSON.stringify(details);
  for (const privateValue of ["PRIVATE_QUERY", "PRIVATE_AUTHORIZATION", "PRIVATE_ERROR", "PRIVATE_PATH", "PRIVATE_BODY", "PRIVATE_NESTED", "PRIVATE_PASSWORD", ...accounts.map((account) => account.accessToken)]) assert.ok(!serialized.includes(privateValue), privateValue);
  const workflows: ActionScope[] = [];
  const actions = createActionRunner(client);
  const workflow = actions.handler("synthetic.workflow", "smoke.workflow", async (scope) => {
    workflows.push(scope);
    for (let step = 0; step < 2; step++) {
      await Promise.resolve();
      await traceRequest(client, "/health", "GET", "", async (headers, received) => {
        const response = await fetch(`${origin}/health`, { headers }); received(response.status); return response;
      }, scope);
    }
  });
  await Promise.all([workflow(), workflow()]);
  await Promise.all([client.flush(), app.signalMonitor!.flush()]);
  assert.notEqual(workflows[0]!.correlation.actionId, workflows[1]!.correlation.actionId);
  for (const scope of workflows) {
    const rows = store.events({ project: project.id, environment: "development", action: scope.correlation.actionId, limit: 100 }).events;
    const http = rows.filter((event: any) => event.kind === "network");
    assert.equal(http.length, 8);
    assert.equal(new Set(http.map((event: any) => event.request_id)).size, 2);
    assert.equal(new Set(http.map((event: any) => event.trace_id)).size, 1);
    assert.ok(rows.some((event: any) => event.name === "synthetic.workflow.completed"));
  }
  // New immutable snapshots follow a tenant change; earlier events retain theirs.
  client.setContext({ companyId: accounts[1]!.hotel.id, companyName: accounts[1]!.hotel.name });
  client.info("synthetic.company.changed"); await client.flush();
  const changed = store.events({ project: project.id, environment: "development", session: sessionId, limit: 200 }).events.find((event: any) => event.name === "synthetic.company.changed");
  assert.equal(changed.company_id, accounts[1]!.hotel.id);
  const previous = store.event(network[0].row_id);
  assert.equal(previous.company_id, accounts[0]!.hotel.id);
  assert.ok(previous.emitterId); assert.equal(previous.sdkVersion, "0.3.0");
  assert.equal(previous.view_status, "registered"); assert.equal(previous.context_status, "registered");
  assert.equal(previous.sessionKind, "user"); assert.ok(previous.session_number > 0);
  // A client reference cannot impersonate authentication on an anonymous request.
  const anonymousRequest = client.getRequestHeaders({ requestId: "00000000-0000-4000-8000-000000000001" });
  const denied = await fetch(`${origin}/v1/hotel`, { headers: anonymousRequest }); assert.equal(denied.status, 401);
  await app.signalMonitor!.flush();
  const rejected = store.events({ project: project.id, environment: "development", request: anonymousRequest["X-Signal-Request-Id"], limit: 100 }).events;
  assert.ok(rejected.every((event: any) => !event.user_id && !event.company_id));
  const logout = await fetch(`${origin}/v1/auth/logout`, { method: "POST", headers: { ...client.getRequestHeaders(), authorization: `Bearer ${accounts[0]!.accessToken}` } });
  assert.equal(logout.status, 204);
  client.resetUser(); client.info("synthetic.logout.completed"); await client.flush();
  assert.notEqual(client.getContext().sessionId, sessionId);
  const anonymous = store.session(project.id, "development", client.getContext().sessionId).events;
  assert.ok(anonymous.every((event: any) => !event.user_id && !event.company_id && event.authState === "anonymous"));
  assert.equal(client.getContext().sessionNumber, 2);
  const offline = createMonitor({ endpoint: "http://127.0.0.1:1/api/ingest", token: "synthetic-offline", platform: "web", service: "ospio-outage-test", serviceVersion: "synthetic-release", persistSession: false });
  try {
    const unchanged = await traceRequest(offline, "/health", "GET", "", async () => 42);
    assert.equal(unchanged, 42); await offline.flush(); assert.ok(offline.pendingCount() > 0);
  } finally { await offline.stop(); }
  console.info(`Signal collector smoke passed: ${events.length} initial events plus concurrent multi-request workflows; client/server/action correlation, privacy, pagination, authenticated tenant isolation, immutable switching snapshots, registered views, SDK/emitter/session fields, collector outage and logout verified.`);
} finally {
  await Promise.all([client.stop(), other.stop(), isolated.stop()]);
  await app.close(); await collector.close(); store.close(); await rm(dir, { recursive: true, force: true });
}
