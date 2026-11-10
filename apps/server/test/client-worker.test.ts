import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { clientIdentity, clientMatch, ensureClientIdentity } from "../src/services/client-identity.js";
import { ClientWorker, ClientWorkerLoop } from "../src/services/client-worker.js";

const logger = { info: vi.fn(), error: vi.fn() };
describe("contact identity", () => {
  it("normalises email and international phones without guessing countries", () => {
    expect(clientIdentity({ email: " Anna@Example.com ", phone: "0039 (333) 123-4567" })).toEqual({ normalizedEmail: "anna@example.com", normalizedPhone: "+393331234567" });
    expect(clientIdentity({ email: null, phone: "3331234567" }).normalizedPhone).toBeNull();
    expect(() => ensureClientIdentity({ email: null, phone: "3331234567" })).toThrow("country code");
  });
  it("rejects competing identities and shared phone conflicts", () => {
    const a = { id: "a", normalizedEmail: "a@example.com", normalizedPhone: "+393331234567" };
    expect(() => clientMatch([a, { ...a, id: "b" }], { normalizedEmail: a.normalizedEmail, normalizedPhone: a.normalizedPhone })).toThrow("different contacts");
    expect(() => clientMatch([a], { normalizedEmail: "b@example.com", normalizedPhone: a.normalizedPhone })).toThrow("different email");
  });
});

describe("contact worker", () => {
  it("processes one bounded company batch sequentially and continues past a failure", async () => {
    const order: string[] = [];
    const repository = {
      nextHotel: vi.fn().mockResolvedValue("hotel-a"), pending: vi.fn().mockResolvedValue(["1", "2", "3"]),
      syncInquiry: vi.fn(async (_hotel: string, id: string) => { order.push(id); if (id === "2") throw new AppError(409, "CLIENT_IDENTITY_CONFLICT", "conflict"); }),
      recordFailure: vi.fn().mockResolvedValue(undefined),
    };
    const now = new Date();
    expect(await new ClientWorker(repository, logger, 25).processBatch(now)).toBe(2);
    expect(repository.pending).toHaveBeenCalledWith("hotel-a", now, 25);
    expect(order).toEqual(["1", "2", "3"]);
    expect(repository.recordFailure).toHaveBeenCalledWith("hotel-a", "2", now, "CLIENT_IDENTITY_CONFLICT");
  });
  it("retries database outages on a later tick without overlapping runs", async () => {
    vi.useFakeTimers();
    try {
      const repository = { nextHotel: vi.fn().mockRejectedValue(new Error("offline")), pending: vi.fn(), syncInquiry: vi.fn(), recordFailure: vi.fn() };
      const loop = new ClientWorkerLoop(new ClientWorker(repository, logger), 30_000, logger);
      loop.start(); loop.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(repository.nextHotel).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(repository.nextHotel).toHaveBeenCalledTimes(2);
      await loop.stop();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(repository.nextHotel).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
