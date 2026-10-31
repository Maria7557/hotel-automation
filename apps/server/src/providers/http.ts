export type ProviderFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class ProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly ambiguous = false,
  ) {
    super("Provider request failed.");
    this.name = "ProviderError";
  }
}

export async function providerJson(
  fetchClient: ProviderFetch,
  input: string | URL,
  init: RequestInit,
  provider: string,
): Promise<{ response: Response; body: unknown }> {
  let response: Response;
  try {
    response = await fetchClient(input, { ...init, signal: init.signal ?? AbortSignal.timeout(10_000) });
  } catch (error) {
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
      throw new ProviderError(`${provider}_TIMEOUT`, true);
    }
    throw new ProviderError(`${provider}_NETWORK_ERROR`, true, true);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Provider error bodies are intentionally not propagated or logged.
  }
  return { response, body };
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
