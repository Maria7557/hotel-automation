import { describe, expect, it } from "vitest";
import { manualInquiryInputSchema } from "@hotel/contracts";
import { duplicateRequestDraft } from "../../mobile/src/requests/duplicate-request.js";
import { mockDashboard } from "../../mobile/src/api/mock.js";
import type { HotelRequest } from "../../mobile/src/api/types.js";

describe("duplicating a reservation into a new request draft", () => {
  it("copies all editable reservation and offer details without carrying over identity, acceptance or sending", () => {
    const source: HotelRequest = {
      ...mockDashboard.requests[0]!, locale: "de", note: "Quiet room", receivedVia: "walk_in",
      paymentLinkSentAt: "2026-11-09T10:00:00Z", currentOfferId: "11111111-1111-4111-8111-111111111111",
      offers: [{ id: "old-option", roomId: "22222222-2222-4222-8222-222222222222", roomName: "Deluxe Room", planName: "Flexible rate",
        totalCents: 64_099, note: "Late arrival included", mealPlan: "HB", currency: "EUR", status: "accepted", expiresAt: "2026-11-01T10:00:00Z" }],
    };
    const before = structuredClone(source);
    const draft = duplicateRequestDraft(source);
    expect(draft).toEqual({
      guest: { name: "Anna Rossi", email: "anna@example.com", phone: "+393331234567", language: "de" },
      checkIn: "2026-11-12", checkOut: "2026-11-16", occupancy: { adults: 2, childAges: [7] },
      mealPlan: "HB", receivedVia: "walk_in", note: "Quiet room", sendOffer: false,
      offers: [{ roomId: "22222222-2222-4222-8222-222222222222", planName: "Flexible rate", totalCents: 64_099, note: "Late arrival included" }],
    });
    expect(manualInquiryInputSchema.safeParse(draft).success).toBe(true);
    draft.occupancy.childAges.push(9);
    draft.offers![0]!.planName = "Changed terms";
    draft.guest.name = "Different guest";
    expect(source).toEqual(before);
  });

  it("keeps missing contacts and historical board empty instead of inventing values", () => {
    const source: HotelRequest = {
      ...mockDashboard.requests[1]!, mealPlan: null, occupancy: { adults: 1, childAges: [] },
      email: { status: "unused" }, whatsapp: { status: "unused" }, offers: [],
    };
    const draft = duplicateRequestDraft(source);
    expect(draft).toMatchObject({ guest: { email: null, phone: null, language: "it" },
      mealPlan: null, occupancy: { adults: 1, childAges: [] }, note: "", receivedVia: "other", sendOffer: false });
    expect(draft).not.toHaveProperty("offers");
    expect(manualInquiryInputSchema.safeParse(draft).success).toBe(false);
    expect(manualInquiryInputSchema.safeParse({ ...draft, mealPlan: "BB" }).success).toBe(false);
    expect(manualInquiryInputSchema.safeParse({ ...draft, mealPlan: "BB", guest: { ...draft.guest, email: "guest@example.com", phone: "+393331234567" } }).success).toBe(true);
  });
});
