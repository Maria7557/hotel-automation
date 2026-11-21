import { createMonitoringId, type createMonitor, type EventOptions, type HttpDetails } from "./sdk/index";
import { describeRequest } from "./routes";
import { failureCode, monitoringError, observe } from "./index";
import type { ActionScope } from "./actions";

type Monitor = ReturnType<typeof createMonitor>;
const automaticWrites = new Set(["/v1/auth/preferences", "/v1/notifications/devices", "/v1/clients/request-statuses", "/v1/inquiries/summaries"]);

/** Wraps the existing bounded HTTP operation, including response validation. */
export async function traceRequest<T>(
  monitor: Monitor | null, path: string, method: string, origin: string,
  work: (headers: Record<string, string>, received: (status: number) => void) => Promise<T>,
  scope?: ActionScope,
): Promise<T> {
  if (!monitor) return work({}, () => {});
  const { route, requestName } = describeRequest(path);
  const manual = !scope && !["GET", "HEAD", "OPTIONS"].includes(method) && !automaticWrites.has(route);
  let correlation: EventOptions = { traceId: createMonitoringId(), placement: "apiClient.request", ...(manual ? { actionId: createMonitoringId() } : {}), ...scope?.correlation, requestId: createMonitoringId() };
  observe(() => { correlation = monitor.captureContext(correlation); });
  const http: HttpDetails = { method: method as HttpDetails["method"], requestName, route, url: route, direction: "outgoing", origin, caller: correlation.placement ?? "apiClient.request" };
  const action = `operation.${method}.${requestName}`.slice(0, 108);
  const started = Date.now();
  let status: number | undefined;
  let headers: Record<string, string> = {};
  observe(() => {
    headers = monitor.getRequestHeaders(correlation);
    if (manual) monitor.action(`${action}.started`, correlation);
    monitor.http("request", http, correlation);
  });
  try {
    const result = await work(headers, (value) => { status = value; });
    observe(() => {
      monitor.http("response", { ...http, ...(status === undefined ? {} : { statusCode: status }), durationMs: Date.now() - started }, correlation);
      if (manual) monitor.action(`${action}.completed`, { ...correlation, trigger: "automatic" });
      monitor.debug("api.validation.completed", correlation);
    });
    return result;
  } catch (error) {
    observe(() => scope?.fail(error));
    observe(() => {
      const details = { ...http, ...(status === undefined ? {} : { statusCode: status }), durationMs: Date.now() - started };
      if (status !== undefined) monitor.http("response", details, correlation);
      monitor.error(`api.error.${method}_${requestName}`.slice(0, 120), monitoringError(error), { ...correlation, http: details, attributes: { failureCode: failureCode(error), failedStep: "apiClient.request" } });
      if (manual) monitor.error(`${action}.failed`, monitoringError(error), correlation);
    });
    throw error;
  }
}
