import { AsyncLocalStorage } from "node:async_hooks";
import { createMonitoringId, type EventOptions } from "@hotel/monitoring";

export const monitoringScope = new AsyncLocalStorage<EventOptions>();

/** Persist only opaque correlation, never identity, device data or headers. */
export function monitoringCarrier(): Record<string, string> {
  const current = monitoringScope.getStore();
  const carrier: Record<string, string> = {};
  for (const key of ["sessionId", "actionId", "traceId"] as const) {
    const value = current?.[key];
    if (value && /^[0-9a-f-]{36}$/i.test(value)) carrier[key] = value;
  }
  return carrier;
}

export function jobContext(carrier: unknown): EventOptions {
  const values = carrier && typeof carrier === "object" ? carrier as Record<string, unknown> : {};
  const read = (key: string) => typeof values[key] === "string" && /^[0-9a-f-]{36}$/i.test(values[key]) ? values[key] as string : undefined;
  const originSessionId = read("sessionId");
  return { sessionId: createMonitoringId(), sessionKind: "process", sessionNumber: 0, authState: "unknown", source: "worker",
    traceId: read("traceId") ?? createMonitoringId(), actionId: read("actionId") ?? createMonitoringId(),
    ...(originSessionId ? { attributes: { originSessionId } } : {}) };
}
