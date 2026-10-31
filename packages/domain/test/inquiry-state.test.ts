import { describe, expect, it } from "vitest";
import { deriveInquiryState } from "../src/index.js";
import { delivery, inquiry, offer } from "./fixtures.js";

const now = "2026-11-01T10:00:00Z";

describe("deriveInquiryState", () => {
  it("derives new without storing a status", () => {
    expect(
      deriveInquiryState({ inquiry: inquiry(), offers: [], deliveries: [], now }),
    ).toBe("new");
  });

  it("derives offer_sent from a successful offer delivery", () => {
    expect(
      deriveInquiryState({
        inquiry: inquiry(),
        offers: [offer()],
        deliveries: [delivery()],
        now,
      }),
    ).toBe("offer_sent");
  });

  it("derives requires_confirmation from guest acceptance", () => {
    expect(
      deriveInquiryState({
        inquiry: inquiry(),
        offers: [offer({ acceptedAt: "2026-11-01T09:00:00Z" })],
        deliveries: [delivery()],
        now,
      }),
    ).toBe("requires_confirmation");
  });

  it("prioritizes an explicit attention fact", () => {
    expect(
      deriveInquiryState({
        inquiry: inquiry({ attentionReason: "missing_rate" }),
        offers: [],
        deliveries: [],
        now,
      }),
    ).toBe("needs_attention");
  });

  it("keeps an accepted offer actionable even if an older attention reason remains", () => {
    expect(
      deriveInquiryState({
        inquiry: inquiry({ attentionReason: "manual_review" }),
        offers: [offer({ acceptedAt: "2026-11-01T09:00:00Z" })],
        deliveries: [delivery()],
        now,
      }),
    ).toBe("requires_confirmation");
  });

  it("uses only the latest version", () => {
    expect(
      deriveInquiryState({
        inquiry: inquiry(),
        offers: [
          offer({ version: 1, acceptedAt: "2026-11-01T09:00:00Z" }),
          offer({ id: "offer-2", version: 2 }),
        ],
        deliveries: [delivery()],
        now,
      }),
    ).toBe("new");
  });
});
