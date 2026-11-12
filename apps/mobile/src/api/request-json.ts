export const API_REQUEST_TIMEOUT_MS = 30_000;
export const SESSION_REQUEST_TIMEOUT_MS = 10_000;
export const SLOW_REQUEST_TIMEOUT_MS = 90_000;

export class RequestTimeoutError extends Error {
  constructor() {
    super("The server took too long to respond. Please try again.");
    this.name = "RequestTimeoutError";
  }
}

// Bound both the connection and response body, even if fetch ignores cancellation.
export async function requestJson(url: string, options: RequestInit = {}, timeoutMs = API_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  let rejectCancellation!: (reason: unknown) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  const cancellationReason = () => options.signal?.reason ?? new Error("The request was cancelled.");
  const cancel = () => {
    rejectCancellation(cancellationReason());
    controller.abort();
  };
  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener("abort", cancel, { once: true });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new RequestTimeoutError());
      controller.abort();
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      (async () => {
        if (options.signal?.aborted) throw cancellationReason();
        const response = await fetch(url, { ...options, signal: controller.signal });
        const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
        return { response, body };
      })(),
      deadline,
      cancelled,
    ]);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", cancel);
  }
}
