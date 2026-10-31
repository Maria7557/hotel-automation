import { hotelSchema, type Hotel } from "@hotel/contracts";
import { describe, expect, it } from "vitest";
import { buildOfferDraft } from "../src/index.js";
import { inquiry, rate, room } from "./fixtures.js";

const timestamp = "2026-10-31T10:00:00Z";

function hotel(overrides: Partial<Hotel> = {}): Hotel {
  return hotelSchema.parse({
    id: "hotel-1",
    ownerUserId: "user-1",
    name: "Hotel Sole",
    description: "A quiet place in Italy",
    currency: "EUR",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  });
}

describe("buildOfferDraft", () => {
  it("returns attention without inventing a price when no room fits", () => {
    const result = buildOfferDraft({
      hotel: hotel(),
      rooms: [room({ maxAdults: 2, maxChildren: 0, maxGuests: 2 })],
      ratePeriods: [rate()],
      inquiry: inquiry({ occupancy: { adults: 2, childAges: [4] } }),
    });

    expect(result).toEqual({
      ok: false,
      attentionReason: "no_matching_room",
      issues: [],
    });
  });

  it("returns missing_rate for a tariff gap", () => {
    const result = buildOfferDraft({
      hotel: hotel(),
      rooms: [room()],
      ratePeriods: [rate({ endExclusive: "2027-01-11" })],
      inquiry: inquiry({ checkIn: "2027-01-10", checkOut: "2027-01-12" }),
    });

    expect(result).toEqual({
      ok: false,
      attentionReason: "missing_rate",
      issues: [{ type: "gap", date: "2027-01-11" }],
    });
  });

  it("returns ambiguous_rate for overlapping tariffs", () => {
    const result = buildOfferDraft({
      hotel: hotel(),
      rooms: [room()],
      ratePeriods: [
        rate({ id: "rate-a" }),
        rate({ id: "rate-b", start: "2027-01-10", endExclusive: "2027-01-20" }),
      ],
      inquiry: inquiry(),
    });

    expect(result).toMatchObject({
      ok: false,
      attentionReason: "ambiguous_rate",
      issues: [
        { type: "overlap", date: "2027-01-10", ratePeriodIds: ["rate-a", "rate-b"] },
        { type: "overlap", date: "2027-01-11", ratePeriodIds: ["rate-a", "rate-b"] },
      ],
    });
  });

  it("calculates every plan and orders by capacity before price", () => {
    const compact = room({ id: "compact", name: "Compact", maxGuests: 2 });
    const large = room({
      id: "large",
      name: "Large",
      maxAdults: 4,
      maxChildren: 2,
      maxGuests: 5,
    });
    const result = buildOfferDraft({
      hotel: hotel(),
      rooms: [large, compact],
      ratePeriods: [
        rate({ id: "compact-flex", roomId: "compact", nightlyBaseCents: 12_000 }),
        rate({
          id: "compact-save",
          roomId: "compact",
          planCode: "save",
          planName: "Non-refundable",
          mealPlan: "room_only",
          nightlyBaseCents: 10_000,
        }),
        rate({ id: "large-flex", roomId: "large", nightlyBaseCents: 5_000 }),
      ],
      inquiry: inquiry({ occupancy: { adults: 2, childAges: [] } }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.options.map(({ roomId, planCode, totalCents }) => ({
      roomId,
      planCode,
      totalCents,
    }))).toEqual([
      { roomId: "compact", planCode: "save", totalCents: 20_000 },
      { roomId: "compact", planCode: "breakfast", totalCents: 24_000 },
      { roomId: "large", planCode: "breakfast", totalCents: 10_000 },
    ]);
  });

  it("uses [start,endExclusive) correctly at a tariff boundary", () => {
    const result = buildOfferDraft({
      hotel: hotel(),
      rooms: [room()],
      ratePeriods: [
        rate({ id: "january", endExclusive: "2027-02-01" }),
        rate({
          id: "february",
          start: "2027-02-01",
          endExclusive: "2027-03-01",
          nightlyBaseCents: 15_000,
        }),
      ],
      inquiry: inquiry({ checkIn: "2027-01-31", checkOut: "2027-02-02" }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.options[0]).toMatchObject({
      totalCents: 25_000,
      nights: [
        { date: "2027-01-31", ratePeriodId: "january", totalCents: 10_000 },
        { date: "2027-02-01", ratePeriodId: "february", totalCents: 15_000 },
      ],
    });
  });

  it("applies child age pricing without mutating the inquiry", () => {
    const sourceInquiry = inquiry({ occupancy: { adults: 2, childAges: [8, 14] } });
    const before = structuredClone(sourceInquiry);
    const result = buildOfferDraft({
      hotel: hotel(),
      rooms: [
        room({ maxAdults: 4, maxChildren: 2, maxGuests: 4 }),
      ],
      ratePeriods: [rate()],
      inquiry: sourceInquiry,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.options[0]).toMatchObject({
      totalCents: 26_000,
      nights: [
        { extraAdultCents: 2_000, extraChildCents: 1_000, totalCents: 13_000 },
        { extraAdultCents: 2_000, extraChildCents: 1_000, totalCents: 13_000 },
      ],
    });
    expect(sourceInquiry).toEqual(before);
  });

  it("returns at most three deterministic, deeply frozen snapshots", () => {
    const result = buildOfferDraft({
      hotel: hotel({
        photos: [
          { url: "https://example.com/hotel.jpg", alt: "Hotel", sortOrder: 0 },
        ],
      }),
      rooms: [room()],
      ratePeriods: [
        rate({ id: "rate-d", planCode: "d", planName: "D", nightlyBaseCents: 13_000 }),
        rate({ id: "rate-b", planCode: "b", planName: "B", nightlyBaseCents: 11_000 }),
        rate({ id: "rate-c", planCode: "c", planName: "C", nightlyBaseCents: 12_000 }),
        rate({ id: "rate-a", planCode: "a", planName: "A", nightlyBaseCents: 10_000 }),
      ],
      inquiry: inquiry(),
      maxOptions: 10,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.options.map(({ planCode }) => planCode)).toEqual(["a", "b", "c"]);
    expect(Object.isFrozen(result.draft)).toBe(true);
    expect(Object.isFrozen(result.draft.options)).toBe(true);
    expect(Object.isFrozen(result.draft.hotelSnapshot.photos[0])).toBe(true);
  });

  it("keeps a valid option when another plan has a gap", () => {
    const result = buildOfferDraft({
      hotel: hotel(),
      rooms: [room()],
      ratePeriods: [
        rate(),
        rate({
          id: "broken",
          planCode: "broken",
          planName: "Broken",
          endExclusive: "2027-01-11",
        }),
      ],
      inquiry: inquiry(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.options.map(({ planCode }) => planCode)).toEqual(["breakfast"]);
  });
});
