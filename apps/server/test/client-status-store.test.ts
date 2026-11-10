import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientStatusStore } from "../../mobile/src/clients/status-store.js";

afterEach(() => vi.useRealTimers());
describe("independent request contact indicators", () => {
  it("batches row subscriptions and represents missing, present and omitted results independently", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => [{ inquiryId: "a", inContacts: true }, { inquiryId: "b", inContacts: false }]);
    const store = new ClientStatusStore(fetch);
    const a = vi.fn(), b = vi.fn();
    store.subscribe("a", a); store.subscribe("b", b); store.subscribe("c", vi.fn());
    expect(store.get("a")).toBe("loading"); expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.get("a")).toBe("present"); expect(store.get("b")).toBe("missing"); expect(store.get("c")).toBe("error");
    a.mockClear(); store.markPresent("b"); expect(a).not.toHaveBeenCalled(); expect(b).toHaveBeenCalledTimes(2);
    store.dispose();
  });
  it("shows errors instead of missing-contact actions when status lookup fails, and supports retry", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([{ inquiryId: "a", inContacts: true }]);
    const store = new ClientStatusStore(fetch);
    store.subscribe("a", vi.fn());
    await vi.advanceTimersByTimeAsync(250); expect(store.get("a")).toBe("error");
    store.retry("a"); await vi.advanceTimersByTimeAsync(250); expect(store.get("a")).toBe("present");
    store.dispose();
  });
  it("does not let a stale status response undo a successful manual addition", async () => {
    vi.useFakeTimers();
    let resolve!: (value: Array<{ inquiryId: string; inContacts: boolean }>) => void;
    const store = new ClientStatusStore(() => new Promise((done) => { resolve = done; }));
    store.subscribe("a", vi.fn());
    await vi.advanceTimersByTimeAsync(250);
    store.markPresent("a"); resolve([{ inquiryId: "a", inContacts: false }]);
    await vi.advanceTimersByTimeAsync(0); expect(store.get("a")).toBe("present"); store.dispose();
  });
  it("updates linked client navigation when polling resolves a contact or changes its match", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce([{ inquiryId: "a", inContacts: true, clientId: "first" }])
      .mockResolvedValue([{ inquiryId: "a", inContacts: true, clientId: "second" }]);
    const store = new ClientStatusStore(fetch);
    const changed = vi.fn(); store.subscribe("a", changed);
    await vi.advanceTimersByTimeAsync(250); expect(store.getClientId("a")).toBe("first");
    await vi.advanceTimersByTimeAsync(60_000); expect(store.getClientId("a")).toBe("second");
    expect(changed).toHaveBeenCalledTimes(2);
    store.markPresent("a", "manual"); expect(store.getClientId("a")).toBe("manual"); store.dispose();
  });
  it("caps batches at 100 and stops polling after unmount", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async (ids: string[]) => ids.map((inquiryId) => ({ inquiryId, inContacts: true })));
    const store = new ClientStatusStore(fetch);
    const unsubscribes = Array.from({ length: 205 }, (_, i) => store.subscribe(String(i), vi.fn()));
    await vi.advanceTimersByTimeAsync(750);
    expect(fetch.mock.calls.map(([ids]) => ids.length)).toEqual([100, 100, 5]);
    expect(store.get("204")).toBe("present");
    unsubscribes.forEach((unsubscribe) => unsubscribe()); await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(3); store.dispose();
  });
});
