export * from "./sdk/index";
export { describeRequest } from "./routes";
import type { MonitorOptions } from "./sdk/index";

export type SignalConfig = {
  endpoint?: string | undefined;
  environment?: string | undefined;
  developmentKey?: string | undefined;
  productionKey?: string | undefined;
};

// Missing or invalid telemetry configuration must never prevent app startup.
// An environment never falls back to the other environment's key.
export function signalCredentials(config: SignalConfig): Pick<MonitorOptions, "endpoint" | "token"> | null {
  if (!["development", "production"].includes(config.environment ?? "")) return null;
  const token = (config.environment === "production" ? config.productionKey : config.developmentKey)?.trim();
  if (!token || !config.endpoint) return null;
  try {
    const url = new URL(config.endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    if (config.environment === "production" && url.protocol !== "https:") return null;
    return { endpoint: url.href, token };
  } catch { return null; }
}

export function observe(work: () => unknown): void {
  try { work(); } catch { /* Telemetry cannot change application outcomes. */ }
}

export function failureCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.code)) return error.code;
  if (error instanceof Error && error.name === "ZodError") return "VALIDATION_ERROR";
  return "OPERATION_FAILED";
}

export function isRejection(error: unknown): boolean {
  if (error instanceof Error && error.name === "ZodError") return true;
  if (!error || typeof error !== "object") return false;
  const status = "statusCode" in error ? error.statusCode : "status" in error ? error.status : undefined;
  return typeof status === "number" && status >= 400 && status < 500;
}

// Keep source locations, never exception text, local home paths, URL queries or
// function names (which can themselves contain values). Use matching source maps
// privately to resolve production bundle line/column locations.
export function monitoringError(error: unknown): Error {
  const safe = new Error(`Application operation failed (${failureCode(error)}).`);
  if (error instanceof Error && ["TypeError", "RangeError", "ReferenceError", "SyntaxError", "TimeoutError", "AbortError", "AppError", "ApiError", "ProviderError", "ZodError"].includes(error.name)) safe.name = error.name;
  delete safe.stack;
  if (error instanceof Error && typeof error.stack === "string") {
    const frames = error.stack.split("\n").slice(1).flatMap((line) => {
      const match = line.match(/((?:apps\/(?:server|mobile)\/(?:src\/[A-Za-z0-9_./-]+|App\.tsx|index\.ts\.bundle)|packages\/[A-Za-z0-9_-]+\/src\/[A-Za-z0-9_./-]+|(?:^|\/)dist\/(?:index|client-worker)\.js))(?:\?[^\s):]*)?:(\d+):(\d+)\)?\s*$/);
      return match ? [`    at ${match[1]!.replace(/^\//, "")}:${match[2]}:${match[3]}`] : [];
    }).slice(0, 12);
    if (frames.length) safe.stack = `${safe.name}: ${safe.message}\n${frames.join("\n")}`;
  }
  return safe;
}
