import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../src/db/client.js";
import { createMailDatabase } from "../src/db/client.js";
import { createPostgresRepositories } from "../src/repositories/postgres.js";
vi.mock("../src/db/client.js", async (original) => ({ ...(await original<object>()), createMailDatabase: vi.fn() }));

describe("dedicated mail session cleanup", () => {
  beforeEach(() => vi.resetAllMocks());
  it("does not overwrite confirmed acceptance with a socket-close cleanup error", async () => {
    const client = Object.assign(vi.fn(async () => [{ acquired: true }]), { end: vi.fn(async () => { throw new Error("synthetic close error"); }) });
    const db = { $client: { options: { max: 10 } } } as unknown as Database;
    vi.mocked(createMailDatabase).mockReturnValue({ client, db } as unknown as ReturnType<typeof createMailDatabase>);
    const repository = createPostgresRepositories(db).channels;
    for (let index = 0; index < 12; index += 1) {
      await expect(repository.withMailConnectionLock(`hotel-${index}`, async () => "provider-accepted")).resolves.toBe("provider-accepted");
    }
    expect(client.end).toHaveBeenCalledTimes(12);
  });
  it("preserves a business failure and releases capacity when session construction fails", async () => {
    const db = { $client: { options: { max: 10 } } } as unknown as Database;
    vi.mocked(createMailDatabase).mockImplementation(() => { throw new Error("synthetic factory failure"); });
    const repository = createPostgresRepositories(db).channels;
    for (let index = 0; index < 12; index += 1) {
      await expect(repository.withMailConnectionLock("hotel", async () => "never")).rejects.toThrow("synthetic factory failure");
    }
  });
});
