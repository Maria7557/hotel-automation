import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { uiDiagnosticsSchema } from "@hotel/contracts";
import { createMonitor, monitoringError, observe, signalCredentials } from "@hotel/monitoring";

import type { SignalEnv } from "../../monitoring/index.js";
import type { AuthService } from "../../services/auth.js";
import { requireAuthentication } from "../authenticate.js";

export async function registerUiDiagnostics(app: FastifyInstance, auth: AuthService, env: Partial<SignalEnv>): Promise<void> {
  const credentials = signalCredentials({
    endpoint: env.SIGNAL_ENDPOINT, environment: env.NODE_ENV === "production" ? "production" : "development",
    developmentKey: env.SIGNAL_WRITE_KEY_DEVELOPMENT, productionKey: env.SIGNAL_WRITE_KEY_PRODUCTION,
  });
  const monitor = credentials ? createMonitor({
    ...credentials, platform: "web", service: "ospio-ui-diagnostics", strictPrivacy: true,
    captureBrowserErrors: false, maxQueueSize: 100, maxRetries: 3, maxQueueAgeMs: 300_000,
  }) : undefined;
  const buckets = new Map<string, number>();
  let globalStart = Date.now(), globalCount = 0;

  app.addHook("onClose", async () => { await monitor?.stop(); });
  app.post("/v1/diagnostics", { bodyLimit: 1024, preHandler: requireAuthentication(auth) }, async (req, reply) => {
    if (!req.currentUser) return reply.code(401).send({ error: { code: "UNAUTHORIZED" } });
    const result = uiDiagnosticsSchema.safeParse(req.body);
    if (!result.success) return reply.code(400).send({ error: { code: "INVALID_DIAGNOSTICS" } });

    const now = Date.now();
    if (now - globalStart >= 60_000) { globalStart = now; globalCount = 0; buckets.clear(); }
    // Account identity stays in local rate-limiting state, not in telemetry.
    const id = createHash("sha256").update(req.currentUser.id).digest("hex");
    const count = buckets.get(id) ?? 0;
    const size = result.data.events.length;
    if (globalCount + size > 100 || count + size > 10) {
      return reply.code(429).header("Retry-After", "60").send({ error: { code: "DIAGNOSTICS_RATE_LIMIT" } });
    }
    globalCount += size;
    buckets.set(id, count + size);
    for (const event of result.data.events) {
      observe(() => {
        if (event.name === "ui.screen.viewed") monitor?.info(event.name, { screen: event.screen });
        else monitor?.error(event.name, monitoringError(null), { screen: event.screen });
      });
    }
    return reply.code(202).send({ accepted: size });
  });
}
