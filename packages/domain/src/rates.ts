import type { Occupancy, RatePeriod, Room } from "@hotel/contracts";
import { enumerateNights } from "./dates.js";

export type RateIssue =
  | { type: "overlap"; date: string; ratePeriodIds: string[] }
  | { type: "gap"; date: string }
  | { type: "min_stay"; ratePeriodId: string; requiredNights: number };

export type CalculatedNight = {
  date: string;
  ratePeriodId: string;
  baseCents: number;
  extraAdultCents: number;
  extraChildCents: number;
  breakfastCents: number;
  totalCents: number;
};

export type StayPrice = {
  roomId: string;
  planCode: string;
  currency: string;
  nights: CalculatedNight[];
  totalCents: number;
};

export type PriceFailure = {
  ok: false;
  issues: RateIssue[];
};

export type PriceSuccess = {
  ok: true;
  price: StayPrice;
};

export function roomFitsOccupancy(room: Room, occupancy: Occupancy): boolean {
  const children = occupancy.childAges.length;
  return (
    room.active &&
    occupancy.adults <= room.maxAdults &&
    children <= room.maxChildren &&
    occupancy.adults + children <= room.maxGuests
  );
}

export function selectRoomsByCapacity(
  rooms: readonly Room[],
  occupancy: Occupancy,
): Room[] {
  return rooms.filter((room) => roomFitsOccupancy(room, occupancy));
}

export function findRateIssues(
  periods: readonly RatePeriod[],
  start: string,
  endExclusive: string,
): RateIssue[] {
  const active = periods.filter((period) => period.active);
  const issues: RateIssue[] = [];

  for (const date of enumerateNights(start, endExclusive)) {
    const matches = active.filter(
      (period) => period.start <= date && date < period.endExclusive,
    );
    if (matches.length === 0) issues.push({ type: "gap", date });
    if (matches.length > 1) {
      issues.push({
        type: "overlap",
        date,
        ratePeriodIds: matches.map(({ id }) => id).sort(),
      });
    }
  }

  return issues;
}

export function calculateStayPrice(input: {
  roomId: string;
  planCode: string;
  checkIn: string;
  checkOut: string;
  occupancy: Occupancy;
  periods: readonly RatePeriod[];
}): PriceSuccess | PriceFailure {
  const relevant = input.periods.filter(
    (period) =>
      period.active &&
      period.roomId === input.roomId &&
      period.planCode === input.planCode &&
      period.start < input.checkOut &&
      input.checkIn < period.endExclusive,
  );
  const issues = findRateIssues(relevant, input.checkIn, input.checkOut);
  if (issues.length > 0) return { ok: false, issues };

  const nightsCount = enumerateNights(input.checkIn, input.checkOut).length;
  const minimumStayViolations = relevant.filter(
    (period) =>
      period.start < input.checkOut &&
      input.checkIn < period.endExclusive &&
      nightsCount < period.minNights,
  );
  if (minimumStayViolations.length > 0) {
    return {
      ok: false,
      issues: minimumStayViolations.map((period) => ({
        type: "min_stay" as const,
        ratePeriodId: period.id,
        requiredNights: period.minNights,
      })),
    };
  }

  const currencies = new Set(relevant.map(({ currency }) => currency));
  if (currencies.size !== 1) {
    throw new Error("A room and plan must use one currency for the whole stay");
  }

  const nights = enumerateNights(input.checkIn, input.checkOut).map((date) => {
    const rate = relevant.find(
      (period) => period.start <= date && date < period.endExclusive,
    );
    if (!rate) throw new Error(`Invariant failed: no rate for ${date}`);

    const childrenCountedAsAdults = input.occupancy.childAges.filter(
      (age) => age > rate.maxChildAge,
    ).length;
    const extraAdults = Math.max(
      0,
      input.occupancy.adults + childrenCountedAsAdults - rate.includedAdults,
    );
    const chargeableChildren = input.occupancy.childAges.filter(
      (age) => age <= rate.maxChildAge,
    ).length;
    const extraChildren = Math.max(
      0,
      chargeableChildren - rate.includedChildren,
    );
    const extraAdultCents = extraAdults * rate.extraAdultCents;
    const extraChildCents = extraChildren * rate.extraChildCents;
    const breakfastCents = rate.mealPlan === "breakfast"
      ? (input.occupancy.adults + childrenCountedAsAdults) * rate.breakfastAdultCents +
        chargeableChildren * rate.breakfastChildCents
      : 0;

    return {
      date,
      ratePeriodId: rate.id,
      baseCents: rate.nightlyBaseCents,
      extraAdultCents,
      extraChildCents,
      breakfastCents,
      totalCents: rate.nightlyBaseCents + extraAdultCents + extraChildCents + breakfastCents,
    };
  });

  return {
    ok: true,
    price: {
      roomId: input.roomId,
      planCode: input.planCode,
      currency: relevant[0]?.currency ?? "EUR",
      nights,
      totalCents: nights.reduce((sum, night) => sum + night.totalCents, 0),
    },
  };
}
