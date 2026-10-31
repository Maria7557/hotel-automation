import { describe, expect, it } from "vitest";
import {
  calculateStayPrice,
  findRateIssues,
  selectRoomsByCapacity,
} from "../src/index.js";
import { rate, room } from "./fixtures.js";

describe("rate coverage", () => {
  it("uses [start, endExclusive) boundaries without overlap", () => {
    const periods = [
      rate({ id: "winter", start: "2027-01-01", endExclusive: "2027-02-01" }),
      rate({ id: "spring", start: "2027-02-01", endExclusive: "2027-03-01" }),
    ];

    expect(findRateIssues(periods, "2027-01-31", "2027-02-02")).toEqual([]);
  });

  it("reports every uncovered night", () => {
    const periods = [
      rate({ start: "2027-01-01", endExclusive: "2027-01-03" }),
      rate({ id: "rate-2", start: "2027-01-05", endExclusive: "2027-01-07" }),
    ];

    expect(findRateIssues(periods, "2027-01-02", "2027-01-06")).toEqual([
      { type: "gap", date: "2027-01-03" },
      { type: "gap", date: "2027-01-04" },
    ]);
  });

  it("reports overlapping rate ids deterministically", () => {
    const periods = [
      rate({ id: "b", start: "2027-01-01", endExclusive: "2027-01-04" }),
      rate({ id: "a", start: "2027-01-03", endExclusive: "2027-01-05" }),
    ];

    expect(findRateIssues(periods, "2027-01-03", "2027-01-04")).toEqual([
      { type: "overlap", date: "2027-01-03", ratePeriodIds: ["a", "b"] },
    ]);
  });
});

describe("stay calculator", () => {
  it("calculates each night across rate boundaries", () => {
    const result = calculateStayPrice({
      roomId: "room-1",
      planCode: "breakfast",
      checkIn: "2027-01-31",
      checkOut: "2027-02-02",
      occupancy: { adults: 2, childAges: [] },
      periods: [
        rate({ id: "winter", start: "2027-01-01", endExclusive: "2027-02-01" }),
        rate({
          id: "spring",
          start: "2027-02-01",
          endExclusive: "2027-03-01",
          nightlyBaseCents: 13_000,
        }),
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      price: {
        currency: "EUR",
        totalCents: 23_000,
        nights: [
          { date: "2027-01-31", ratePeriodId: "winter", totalCents: 10_000 },
          { date: "2027-02-01", ratePeriodId: "spring", totalCents: 13_000 },
        ],
      },
    });
  });

  it("adds supplements only above included occupancy", () => {
    const result = calculateStayPrice({
      roomId: "room-1",
      planCode: "breakfast",
      checkIn: "2027-01-10",
      checkOut: "2027-01-11",
      occupancy: { adults: 3, childAges: [8, 14] },
      periods: [rate()],
    });

    expect(result).toMatchObject({
      ok: true,
      price: {
        totalCents: 15_000,
        nights: [{ extraAdultCents: 4_000, extraChildCents: 1_000 }],
      },
    });
  });

  it("blocks calculation when a night has no tariff", () => {
    const result = calculateStayPrice({
      roomId: "room-1",
      planCode: "breakfast",
      checkIn: "2027-01-31",
      checkOut: "2027-02-02",
      occupancy: { adults: 2, childAges: [] },
      periods: [rate({ endExclusive: "2027-02-01" })],
    });

    expect(result).toEqual({
      ok: false,
      issues: [{ type: "gap", date: "2027-02-01" }],
    });
  });

  it("reports a minimum-stay violation explicitly", () => {
    const result = calculateStayPrice({
      roomId: "room-1",
      planCode: "breakfast",
      checkIn: "2027-01-10",
      checkOut: "2027-01-12",
      occupancy: { adults: 2, childAges: [] },
      periods: [rate({ minNights: 3 })],
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        { type: "min_stay", ratePeriodId: "rate-1", requiredNights: 3 },
      ],
    });
  });
});

describe("room capacity", () => {
  it("filters inactive rooms and every capacity dimension", () => {
    const rooms = [
      room({ id: "fit" }),
      room({ id: "too-small", maxChildren: 0, maxGuests: 2 }),
      room({ id: "inactive", active: false }),
    ];

    expect(
      selectRoomsByCapacity(rooms, { adults: 2, childAges: [6] }).map(({ id }) => id),
    ).toEqual(["fit"]);
  });
});
