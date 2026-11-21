import type { FastifyInstance, FastifyRequest } from "fastify";
import { attachApiMonitor } from "@hotel/monitoring/adapters";
import { createMonitor, createMonitoringId, monitoringError, observe, signalCredentials, type EventOptions, type HttpDetails } from "@hotel/monitoring";
import type { AppEnv } from "../config/env.js";
import { browserBundle } from "./browser-bundle.js";
import type { PublicUser } from "../repositories/types.js";
import { monitoringScope as scope } from "./scope.js";
import { describeProvider } from "./providers.js";

export type SignalEnv = Pick<AppEnv, "NODE_ENV" | "SIGNAL_ENDPOINT" | "SIGNAL_WRITE_KEY_DEVELOPMENT" | "SIGNAL_WRITE_KEY_PRODUCTION" | "SIGNAL_PUBLIC_WRITE_KEY_DEVELOPMENT" | "SIGNAL_PUBLIC_WRITE_KEY_PRODUCTION" | "SIGNAL_RELEASE" | "SIGNAL_API_RELEASE" | "SIGNAL_WORKER_RELEASE">;
export type ApiMonitor = ReturnType<typeof attachApiMonitor>;

declare module "fastify" {
  interface FastifyInstance {
    signalMonitor: ApiMonitor | null;
    signalBrowserScript: string;
    signalPageContext: { collectorOrigin: string } | undefined;
    signalResolveHotel: ((userId: string) => Promise<{ id: string; name: string } | null>) | undefined;
  }
  interface FastifyRequest { signalIdentity: EventOptions | null }
  interface FastifyContextConfig { signal?: { requestName?: string; placement?: string } }
}

export function attachMonitoring(app: FastifyInstance, env: Partial<SignalEnv>, resolveHotel?: (userId: string) => Promise<{ id: string; name: string } | null>) {
  app.decorateRequest("signalIdentity", null);
  app.decorate("signalResolveHotel", resolveHotel);
  const publicCredentials = signalCredentials({ endpoint: env.SIGNAL_ENDPOINT, environment: env.NODE_ENV === "production" ? "production" : "development",
    developmentKey: env.SIGNAL_PUBLIC_WRITE_KEY_DEVELOPMENT, productionKey: env.SIGNAL_PUBLIC_WRITE_KEY_PRODUCTION });
  app.decorate("signalBrowserScript", publicCredentials ? `${browserBundle}\n;OspioSignalRuntime.install(${JSON.stringify({ ...publicCredentials, environment: env.NODE_ENV === "production" ? "production" : "development", release: env.SIGNAL_RELEASE ?? "0.1.0" })});\n` : "");
  app.decorate("signalPageContext", publicCredentials ? { collectorOrigin: new URL(publicCredentials.endpoint).origin } : undefined);
  app.get("/signal.js", async (_request, reply) => reply.header("Cache-Control", "no-store").type("application/javascript; charset=utf-8").send(app.signalBrowserScript || ";"));
  app.addHook("preValidation", async (request) => {
    // HTML forms cannot set headers. Read only this explicit correlation carrier
    // on owned offer POST routes; never infer identity or record any body fields.
    const route = request.routeOptions.url ?? "";
    if (request.method !== "POST" || !/^\/(proposal\/|v1\/public\/offers\/).*\/accept$/.test(route)) return;
    if (!request.body || typeof request.body !== "object") return;
    const fields = { _signalSessionId: "x-signal-session-id", _signalContextId: "x-signal-context-id", _signalViewId: "x-signal-view-id", _signalActionId: "x-signal-action-id", _signalRequestId: "x-signal-request-id", _signalTraceId: "x-signal-trace-id", _signalPlacement: "x-signal-placement" };
    for (const [field, header] of Object.entries(fields)) {
      const value = (request.body as Record<string, unknown>)[field];
      const valid = header === "x-signal-placement" ? typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9._:/-]{0,199}$/.test(value)
        : typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
      if (valid && !request.headers[header]) request.headers[header] = value as string;
    }
  });
  const credentials = signalCredentials({ endpoint: env.SIGNAL_ENDPOINT, environment: env.NODE_ENV === "production" ? "production" : "development",
    developmentKey: env.SIGNAL_WRITE_KEY_DEVELOPMENT, productionKey: env.SIGNAL_WRITE_KEY_PRODUCTION });
  let monitor: ApiMonitor | null = null;
  if (credentials) {
    try {
      monitor = attachApiMonitor({ addHook(name, hook) {
        // The upstream adapter accepts errors; sanitize before they enter its queue.
        if (name === "onError") app.addHook("onError", async (request, reply, error) => hook(request, reply, monitoringError(error)));
        else app.addHook(name === "onRequest" ? "preValidation" : name, hook);
      } }, {
        ...credentials, platform: "server", service: "ospio-api", serviceVersion: env.SIGNAL_API_RELEASE ?? env.SIGNAL_RELEASE ?? "0.1.0",
        strictPrivacy: false, maxQueueSize: 500, maxRetries: 5, maxQueueAgeMs: 3_600_000,
        getContext: (incoming) => {
          const request = incoming as FastifyRequest;
          return { ...request.signalIdentity, userId: request.currentUser?.id ?? "", userName: request.currentUser?.displayName ?? "",
            authState: request.currentUser ? "authenticated" : request.signalIdentity?.authState ?? "unknown" };
        },
        onDiagnostic: ({ reason, count }) => app.log.warn({ reason, count }, "Signal monitoring diagnostic"),
      });
      const current = monitor;
      app.addHook("onRequest", (request, _reply, done) => {
        let context: EventOptions = {};
        observe(() => { context = current.requestContext(request); });
        scope.run(context, done);
      });
      app.addHook("preValidation", async (request) => {
        observe(() => { Object.assign(scope.getStore() ?? {}, current.requestContext(request)); });
      });
      app.addHook("onResponse", async (request, reply) => {
        observe(() => {
          const context = current.requestContext(request);
          if (reply.statusCode >= 400) current.warn("api.handler.rejected", context);
          else current.info("api.handler.completed", context);
        });
      });
    } catch { /* Configuration and telemetry cannot prevent startup. */ }
  }
  app.decorate("signalMonitor", monitor);
  return monitor;
}

export function createWorkerMonitor(env: SignalEnv, service = "ospio-client-worker") {
  const credentials = signalCredentials({ endpoint: env.SIGNAL_ENDPOINT, environment: env.NODE_ENV === "production" ? "production" : "development",
    developmentKey: env.SIGNAL_WRITE_KEY_DEVELOPMENT, productionKey: env.SIGNAL_WRITE_KEY_PRODUCTION });
  if (!credentials) return null;
  try { return createMonitor({ ...credentials, platform: "server", service, serviceVersion: env.SIGNAL_WORKER_RELEASE ?? env.SIGNAL_RELEASE ?? "0.1.0", strictPrivacy: false, maxRetries: 5, maxQueueAgeMs: 3_600_000,
    onDiagnostic: ({ reason, count }) => console.warn("Signal worker monitoring:", reason, count ?? 0) }); }
  catch { return null; }
}

type Monitor = ReturnType<typeof createMonitor>;
type Logger = { info(fields: Record<string, unknown>, message: string): void; error(fields: Record<string, unknown>, message: string): void };
export function monitoredLogger(logger: Logger, monitor: Monitor | null, placement: string): Logger {
  return {
    info(fields, message) {
      logger.info(fields, message);
      observe(() => monitor?.info("worker.log.info", { ...scope.getStore(), placement, source: "worker", attributes: {
        count: typeof fields.processed === "number" ? fields.processed : 1,
      } }));
    },
    error(fields, message) {
      logger.error(fields, message);
      observe(() => monitor?.error("worker.log.error", monitoringError(null), { ...scope.getStore(), placement, source: "worker",
        attributes: { failureCode: typeof fields.code === "string" && /^[A-Z][A-Z0-9_]{0,99}$/.test(fields.code) ? fields.code : "WORKER_FAILED" } }));
    },
  };
}

/** Third-party calls expose operation, timing and status only. No URL or headers. */
export function monitoredProviderFetch(monitor: Monitor | null, transport: (input: string | URL, init?: RequestInit) => Promise<Response>, provider: string) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    if (!monitor) return transport(input, init);
    const { http: _incoming, ...parent } = scope.getStore() ?? {};
    const correlation = { ...parent, traceId: parent.traceId ?? createMonitoringId(), requestId: createMonitoringId(), placement: `provider.${provider}.request` };
    const method = (init?.method ?? "GET").toUpperCase() as HttpDetails["method"];
    const operation = describeProvider(provider, input, method);
    const http: HttpDetails = { method, ...operation, url: operation.route, direction: "outgoing", caller: parent.placement ?? "provider.request" };
    const started = Date.now();
    observe(() => monitor.http("request", http, correlation));
    try {
      const response = await transport(input, init);
      observe(() => monitor.http("response", { ...http, statusCode: response.status, durationMs: Date.now() - started }, correlation));
      return response;
    } catch (error) {
      observe(() => monitor.error(`provider.${provider}.failed`, monitoringError(error), { ...correlation, http: { ...http, durationMs: Date.now() - started } }));
      throw error;
    }
  };
}

/** Identity comes from authentication and a bounded trusted membership read.
 * Collector availability never participates in this lookup or request flow. */
export async function authenticatedMonitoringContext(request: FastifyRequest, user: PublicUser) {
  const monitor = request.server.signalMonitor;
  if (!monitor) return;
  request.signalIdentity = { userId: user.id, userName: user.displayName ?? "", companyId: "", companyName: "", authState: "authenticated" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const hotel = await Promise.race([
      Promise.resolve().then(() => request.server.signalResolveHotel?.(user.id)),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 100); }),
    ]);
    if (hotel) Object.assign(request.signalIdentity, { companyId: hotel.id, companyName: hotel.name });
  } catch { /* Optional tenant context must not change authentication outcomes. */ }
  finally { if (timer) clearTimeout(timer); }
  observe(() => Object.assign(scope.getStore() ?? {}, monitor.requestContext(request)));
}

/** Refresh facts after the application's own authenticated hotel read/write. */
export function authenticatedHotelContext(request: FastifyRequest, hotel: { id: string; name: string } | null) {
  if (!request.server.signalMonitor || !request.currentUser) return;
  request.signalIdentity = { ...request.signalIdentity, companyId: hotel?.id ?? "", companyName: hotel?.name ?? "" };
  observe(() => Object.assign(scope.getStore() ?? {}, request.server.signalMonitor!.requestContext(request)));
}
