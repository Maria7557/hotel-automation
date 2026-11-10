import { describe, expect, it } from "vitest";
import { inquirySchema, mealPlanSchema, ratePeriodSchema, roomSchema } from "./entities.js";

const timestamp = "2026-10-31T10:00:00Z";

describe("entity contracts", () => {
  it("accepts exactly BB, HB and FB", () => {
    for (const value of ["BB", "HB", "FB"]) expect(mealPlanSchema.safeParse(value).success).toBe(true);
    for (const value of [undefined, null, "bb", "breakfast", "room_only", "AI"]) expect(mealPlanSchema.safeParse(value).success).toBe(false);
  });
  it("rejects an inverted rate range", () => {
    const result = ratePeriodSchema.safeParse({
      id: "rate-1",
      hotelId: "hotel-1",
      roomId: "room-1",
      planCode: "flex",
      planName: "Flexible",
      start: "2027-02-01",
      endExclusive: "2027-01-01",
      nightlyBaseCents: 10_000,
      currency: "EUR",
      mealPlan: "HB",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(result.success).toBe(false);
  });

  it("requires at least one guest contact", () => {
    const result = inquirySchema.safeParse({
      id: "inquiry-1",
      hotelId: "hotel-1",
      guest: { name: "Anna", email: null, phone: null },
      checkIn: "2027-01-01",
      checkOut: "2027-01-02",
      occupancy: { adults: 2 },
      mealPlan: "BB",
      createdAt: timestamp,
    });

    expect(result.success).toBe(false);
  });

  it("rejects impossible room capacity", () => {
    const result = roomSchema.safeParse({
      id: "room-1",
      hotelId: "hotel-1",
      name: "Double",
      maxAdults: 3,
      maxChildren: 0,
      maxGuests: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(result.success).toBe(false);
  });
});
