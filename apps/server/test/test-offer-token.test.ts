import { describe, expect, it } from "vitest";

import { createTestOfferToken, verifyTestOfferToken } from "../src/lib/test-offer-token.js";

describe("test offer token", () => {
  it("round-trips a short-lived signed preview and rejects tampering", () => {
    const secret = "test-auth-secret-that-is-at-least-32-characters";
    const now = new Date("2026-11-01T12:00:00.000Z");
    const token = createTestOfferToken({
      publicKey: "5717d8b1-d8b8-4427-9313-a47683ed39fe",
      checkIn: "2026-11-10",
      checkOut: "2026-11-12",
      adults: 2,
    }, new Date(now.getTime() + 60_000), secret);
    expect(token.length).toBeLessThanOrEqual(200);
    expect(verifyTestOfferToken(token, secret, now)).toMatchObject({
      publicKey: "5717d8b1-d8b8-4427-9313-a47683ed39fe",
      checkIn: "2026-11-10",
      checkOut: "2026-11-12",
      adults: 2,
    });
    expect(verifyTestOfferToken(`${token.slice(0, -1)}x`, secret, now)).toBeNull();
    expect(verifyTestOfferToken(token, secret, new Date(now.getTime() + 61_000))).toBeNull();
  });
});
