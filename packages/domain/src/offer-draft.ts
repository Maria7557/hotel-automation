import type {
  Hotel,
  Inquiry,
  RatePeriod,
  Room,
} from "@hotel/contracts";
import { calculateStayPrice, roomFitsOccupancy, type RateIssue } from "./rates.js";

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type OfferDraftAttentionReason =
  | "no_matching_room"
  | "missing_rate"
  | "ambiguous_rate";

export type OfferDraftOption = {
  roomId: string;
  roomName: string;
  roomSnapshot: {
    description: string;
    maxAdults: number;
    maxChildren: number;
    maxGuests: number;
    beds: Room["beds"];
    amenities: string[];
    photos: Room["photos"];
  };
  planCode: string;
  planName: string;
  mealPlan: RatePeriod["mealPlan"];
  currency: string;
  nights: {
    date: string;
    ratePeriodId: string;
    baseCents: number;
    extraAdultCents: number;
    extraChildCents: number;
    breakfastCents: number;
    totalCents: number;
  }[];
  totalCents: number;
};

export type OfferDraft = DeepReadonly<{
  inquiryId: string;
  hotelSnapshot: {
    id: string;
    name: string;
    description: string;
    currency: string;
    locale: string;
    timezone: string;
    logoUrl: string | null;
    photos: Hotel["photos"];
  };
  guestSnapshot: {
    name: string;
    checkIn: string;
    checkOut: string;
    occupancy: Inquiry["occupancy"];
  };
  options: OfferDraftOption[];
}>;

export type BuildOfferDraftResult =
  | { readonly ok: true; readonly draft: OfferDraft }
  | {
      readonly ok: false;
      readonly attentionReason: OfferDraftAttentionReason;
      readonly issues: readonly DeepReadonly<RateIssue>[];
    };

export type BuildOfferDraftInput = {
  readonly hotel: Hotel;
  readonly rooms: readonly Room[];
  readonly ratePeriods: readonly RatePeriod[];
  readonly inquiry: Inquiry;
  readonly maxOptions?: number;
};

type Candidate = {
  option: OfferDraftOption;
  spareCapacity: number;
};

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value as DeepReadonly<T>;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function candidateOrder(left: Candidate, right: Candidate): number {
  return (
    left.spareCapacity - right.spareCapacity ||
    left.option.totalCents - right.option.totalCents ||
    compareText(left.option.roomName, right.option.roomName) ||
    compareText(left.option.roomId, right.option.roomId) ||
    compareText(left.option.planCode, right.option.planCode)
  );
}

function planMetadataIsStable(periods: readonly RatePeriod[]): boolean {
  const first = periods[0];
  return (
    first !== undefined &&
    periods.every(
      (period) =>
        period.currency === first.currency &&
        period.planName === first.planName &&
        period.mealPlan === first.mealPlan,
    )
  );
}

export function buildOfferDraft(input: BuildOfferDraftInput): BuildOfferDraftResult {
  const optionLimit = Math.max(1, Math.min(3, input.maxOptions ?? 3));
  const guestCount =
    input.inquiry.occupancy.adults + input.inquiry.occupancy.childAges.length;
  const suitableRooms = input.rooms.filter(
    (room) =>
      room.hotelId === input.hotel.id &&
      input.inquiry.hotelId === input.hotel.id &&
      roomFitsOccupancy(room, input.inquiry.occupancy),
  );

  if (suitableRooms.length === 0) {
    return deepFreeze({
      ok: false as const,
      attentionReason: "no_matching_room" as const,
      issues: [],
    });
  }

  const candidates: Candidate[] = [];
  const failedIssues: RateIssue[] = [];
  let foundUnstablePlan = false;

  for (const room of suitableRooms) {
    const roomRates = input.ratePeriods.filter(
      (period) =>
        period.active &&
        period.hotelId === input.hotel.id &&
        period.roomId === room.id,
    );
    const planCodes = [...new Set(roomRates.map(({ planCode }) => planCode))].sort(
      compareText,
    );

    for (const planCode of planCodes) {
      const planRates = roomRates
        .filter((period) => period.planCode === planCode)
        .sort(
          (left, right) =>
            compareText(left.start, right.start) || compareText(left.id, right.id),
        );
      const stayRates = planRates.filter(
        (period) =>
          period.start < input.inquiry.checkOut &&
          input.inquiry.checkIn < period.endExclusive,
      );

      const metadataStable = planMetadataIsStable(stayRates);
      const currencyMismatch =
        stayRates[0] !== undefined && stayRates[0].currency !== input.hotel.currency;
      if (!metadataStable || currencyMismatch) {
        if (stayRates.length > 1 || currencyMismatch) foundUnstablePlan = true;
        if (stayRates.length === 0) {
          failedIssues.push({ type: "gap", date: input.inquiry.checkIn });
        }
        continue;
      }

      const calculation = calculateStayPrice({
        roomId: room.id,
        planCode,
        checkIn: input.inquiry.checkIn,
        checkOut: input.inquiry.checkOut,
        occupancy: input.inquiry.occupancy,
        periods: planRates,
      });
      if (!calculation.ok) {
        failedIssues.push(...calculation.issues);
        continue;
      }

      const metadata = stayRates[0];
      if (!metadata) continue;
      candidates.push({
        spareCapacity: room.maxGuests - guestCount,
        option: {
          roomId: room.id,
          roomName: room.name,
          roomSnapshot: {
            description: room.description,
            maxAdults: room.maxAdults,
            maxChildren: room.maxChildren,
            maxGuests: room.maxGuests,
            beds: room.beds.map((bed) => ({ ...bed })),
            amenities: [...room.amenities],
            photos: room.photos.map((photo) => ({ ...photo })),
          },
          planCode,
          planName: metadata.planName,
          mealPlan: metadata.mealPlan,
          currency: calculation.price.currency,
          nights: calculation.price.nights.map((night) => ({ ...night })),
          totalCents: calculation.price.totalCents,
        },
      });
    }
  }

  if (candidates.length === 0) {
    const hasOverlap = failedIssues.some(({ type }) => type === "overlap");
    return deepFreeze({
      ok: false as const,
      attentionReason:
        hasOverlap || foundUnstablePlan
          ? ("ambiguous_rate" as const)
          : ("missing_rate" as const),
      issues: failedIssues,
    });
  }

  const options = candidates
    .sort(candidateOrder)
    .slice(0, optionLimit)
    .map(({ option }) => option);

  return deepFreeze({
    ok: true as const,
    draft: {
      inquiryId: input.inquiry.id,
      hotelSnapshot: {
        id: input.hotel.id,
        name: input.hotel.name,
        description: input.hotel.description,
        currency: input.hotel.currency,
        locale: input.hotel.locale,
        timezone: input.hotel.timezone,
        logoUrl: input.hotel.logoUrl,
        photos: input.hotel.photos.map((photo) => ({ ...photo })),
      },
      guestSnapshot: {
        name: input.inquiry.guest.name,
        checkIn: input.inquiry.checkIn,
        checkOut: input.inquiry.checkOut,
        occupancy: {
          adults: input.inquiry.occupancy.adults,
          childAges: [...input.inquiry.occupancy.childAges],
        },
      },
      options,
    },
  });
}
