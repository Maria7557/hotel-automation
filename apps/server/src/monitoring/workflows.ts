import { createMonitoringId, failureCode, isRejection, monitoringError, observe, type createMonitor, type EventOptions } from "@hotel/monitoring";
import { monitoringScope } from "./scope.js";

export type Monitor = ReturnType<typeof createMonitor>;
const jobTimings = new WeakMap<EventOptions, number>();

/** Observe committed service outcomes. No request/return values enter telemetry. */
export function monitoredService<T extends object>(monitor: Monitor | null, service: T, operations: Partial<Record<keyof T, string>>, placement: string): T {
  if (!monitor) return service;
  const methods = new Map<PropertyKey, unknown>();
  return new Proxy(service, {
    get(target, key, receiver) {
      const operation = operations[key as keyof T];
      if (!operation) return Reflect.get(target, key, receiver);
      if (!methods.has(key)) methods.set(key, (...args: unknown[]) => {
        const parent = monitoringScope.getStore();
        const context: EventOptions = { ...parent, actionId: parent?.actionId ?? createMonitoringId(), traceId: parent?.traceId ?? createMonitoringId(), placement: `${placement}.${String(key)}` };
        return monitoringScope.run(context, async () => {
          const started = Date.now();
          observe(() => monitor.action(`${operation}.started`, { ...context, trigger: "automatic" }));
          try {
            const result = await (Reflect.get(target, key) as (...args: unknown[]) => unknown).apply(target, args);
            // Authentication may have enriched this same request-local scope.
            observe(() => monitor.action(`${operation}.completed`, { ...context, trigger: "automatic", attributes: { durationMs: Date.now() - started } }));
            return result;
          } catch (error) {
            observe(() => {
              const details = { ...context, attributes: { failureCode: failureCode(error), failedStep: `${placement}.${String(key)}`, durationMs: Date.now() - started } };
              if (isRejection(error)) monitor.warn(`${operation}.rejected`, details);
              else monitor.error(`${operation}.failed`, monitoringError(error), details);
            });
            throw error;
          }
        });
      });
      return methods.get(key);
    },
  });
}

/** Jobs have process scopes, with the originating user session linked separately. */
export async function monitoredJob<T>(monitor: Monitor | null | undefined, name: string, context: EventOptions, work: () => Promise<T>): Promise<T> {
  if (!monitor) return work();
  const details = { ...context, source: "worker" as const };
  return monitoringScope.run(details, async () => {
    const started = Date.now();
    jobTimings.set(details, started);
    observe(() => monitor.info(`${name}.started`, details));
    try { return await work(); }
    catch (error) {
      observe(() => monitor.error(`${name}.failed`, monitoringError(error), { ...details, attributes: { ...details.attributes, failureCode: failureCode(error), failedStep: details.placement ?? name, durationMs: Date.now() - started } }));
      throw error;
    }
  });
}

export function jobOutcome(monitor: Monitor | null | undefined, name: string, outcome: "completed" | "retry" | "deferred" | "failed" | "unknown", attributes: Record<string, unknown> = {}) {
  const current = monitoringScope.getStore();
  const started = current && jobTimings.get(current);
  const details = { ...current, source: "worker" as const, attributes: { ...current?.attributes, ...attributes, ...(started === undefined ? {} : { durationMs: Date.now() - started }) } };
  observe(() => {
    if (outcome === "failed" || outcome === "unknown") monitor?.error(`${name}.${outcome}`, monitoringError(null), details);
    else if (outcome === "retry" || outcome === "deferred") monitor?.warn(`${name}.${outcome}`, details);
    else monitor?.info(`${name}.completed`, details);
  });
}
