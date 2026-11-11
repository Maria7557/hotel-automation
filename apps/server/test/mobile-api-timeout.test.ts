import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestJson, RequestTimeoutError } from "../../mobile/src/api/request-json.js";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("expo-secure-store", () => ({}));

const pending = () => new Promise<never>(() => {});
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("EXPO_PUBLIC_API_URL", "https://hotel.example");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("API request deadlines", () => {
  it("bounds a stalled connection even when fetch ignores cancellation", async () => {
    fetchMock.mockImplementation(pending);
    const rejected = expect(requestJson("https://hotel.example/health")).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the deadline active until the JSON response body is complete", async () => {
    fetchMock.mockResolvedValue({ status: 200, json: pending } as unknown as Response);
    const rejected = expect(requestJson("https://hotel.example/health", {}, 1000)).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });

  it("preserves headers, cookies and request body and removes its timer after success", async () => {
    fetchMock.mockResolvedValue(Response.json({ data: "saved" }));
    const result = await requestJson("https://hotel.example/v1/hotel", {
      method: "PATCH", headers: { "Accept-Language": "it" }, credentials: "include", body: "{}",
    });
    expect(result.body).toEqual({ data: "saved" });
    expect(fetchMock).toHaveBeenCalledWith("https://hotel.example/v1/hotel", expect.objectContaining({
      method: "PATCH", headers: { "Accept-Language": "it" }, credentials: "include", body: "{}",
    }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up after network errors", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    await expect(requestJson("https://hotel.example/health")).rejects.toThrow("offline");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("supports empty 204 responses and malformed JSON without losing the HTTP status", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }));
    expect((await requestJson("https://hotel.example/logout")).body).toBeNull();
    const result = await requestJson("https://hotel.example/health");
    expect(result.response.status).toBe(502);
    expect(result.body).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors external cancellation even when fetch ignores it and removes the listener", async () => {
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, "removeEventListener");
    fetchMock.mockImplementation(pending);
    const rejected = expect(requestJson("https://hotel.example/health", { signal: caller.signal })).rejects.toThrow("cancelled");
    caller.abort(new Error("cancelled"));
    await rejected;
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never starts a request when the caller has already cancelled it", async () => {
    const caller = new AbortController();
    caller.abort(new Error("cancelled"));
    await expect(requestJson("https://hotel.example/health", { signal: caller.signal })).rejects.toThrow("cancelled");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("mobile API timeout handling", () => {
  async function client() {
    vi.resetModules();
    // Avoid bringing React Native's global declarations into the server's types.
    const modulePath = new URL("../../mobile/src/api/client.ts", import.meta.url).pathname;
    return import(modulePath);
  }
  async function signedInClient() {
    const result = await client();
    fetchMock.mockResolvedValueOnce(Response.json({ data: { user: { id: "staff-1", uiLanguage: "en" } } }));
    await result.apiClient.getSession();
    return result;
  }

  it("fails a stalled session after ten seconds, translates the error and restores on retry", async () => {
    const { apiClient, authErrorMessage } = await client();
    fetchMock.mockImplementationOnce(pending);
    const failed = apiClient.getSession().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await failed;
    expect(error).toMatchObject({ code: "REQUEST_TIMEOUT" });
    expect(authErrorMessage(error)).toBe("The server took too long to respond. Please try again.");
    const { translate } = await import("@hotel/i18n");
    expect(translate("it", authErrorMessage(error))).toBe("Il server ha impiegato troppo tempo a rispondere. Riprova.");
    fetchMock.mockResolvedValue(Response.json({ data: { user: { id: "staff-1" } } }));
    await expect(apiClient.getSession()).resolves.toMatchObject({ id: "staff-1" });
    expect(fetchMock).toHaveBeenLastCalledWith("https://hotel.example/v1/auth/session", expect.objectContaining({ credentials: "include" }));
  });

  it("does not let a late session response sign the app in after its deadline", async () => {
    const { apiClient } = await client();
    let complete!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const rejected = expect(apiClient.getSession()).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    complete(Response.json({ data: { user: { id: "staff-1" } } }));
    await vi.advanceTimersByTimeAsync(0);
    await expect(apiClient.getHotel()).rejects.toMatchObject({ code: "NO_SESSION" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds the hotel lookup and preserves the shorter four-second contacts deadline", async () => {
    const { apiClient } = await signedInClient();
    fetchMock.mockImplementation(pending);
    const hotel = expect(apiClient.getHotel()).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(10_000);
    await hotel;
    const contacts = expect(apiClient.listClients()).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(4000);
    await contacts;
  });

  it("retains ordinary thirty-second deadlines", async () => {
    const { apiClient } = await signedInClient();
    fetchMock.mockImplementation(pending);
    const rejected = expect(apiClient.listRooms()).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
  });

  it("allows a slow upload beyond thirty seconds and clears its deadline on success", async () => {
    const { apiClient } = await signedInClient();
    let complete!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const upload = apiClient.uploadImage({ base64: "synthetic", mimeType: "image/png" });
    await vi.advanceTimersByTimeAsync(40_000);
    expect(fetchMock.mock.calls[1]![1]!.signal!.aborted).toBe(false);
    complete(Response.json({ data: { url: "/media/photo.png" } }));
    await expect(upload).resolves.toBe("/media/photo.png");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["upload", "test-send", "smtp"])("bounds slow %s operations at ninety seconds without retrying writes", async (operation) => {
    const { apiClient, authErrorMessage } = await signedInClient();
    fetchMock.mockImplementation(pending);
    const result = operation === "upload"
      ? apiClient.uploadImage({ base64: "synthetic", mimeType: "image/png" })
      : operation === "test-send"
        ? apiClient.testMessage("email", "guest@example.com")
        : apiClient.connectSmtp({});
    const failed = result.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock.mock.calls[1]![1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    const error = await failed;
    expect(error).toMatchObject({ code: "REQUEST_TIMEOUT" });
    expect(authErrorMessage(error)).toContain("The action may still complete. Refresh before trying again.");
    expect(fetchMock.mock.calls[1]![1]!.signal!.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("continues to recognize an unauthorized session as signed out", async () => {
    const { apiClient } = await client();
    fetchMock.mockResolvedValue(Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }));
    await expect(apiClient.getSession()).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
