import { bedTypeSchema, isoDateSchema, mealPlanSchema, occupancySchema } from "@hotel/contracts";
import { dateToEpochDay, epochDayToDate } from "@hotel/domain";
import { z } from "zod";

const bedSchema = z.object({
  type: bedTypeSchema,
  count: z.number().int().positive().max(10),
});

const roomFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(3_000).nullable(),
  maxAdults: z.number().int().positive().max(20),
  maxChildren: z.number().int().nonnegative().max(20),
  maxGuests: z.number().int().positive().max(40),
  beds: z.array(bedSchema).max(20),
  amenities: z.array(z.string().trim().min(1).max(100)).max(100),
  photoUrls: z.array(z.url().max(2_048)).max(30),
  active: z.boolean(),
};

export const createRoomSchema = z
  .object({
    name: roomFields.name,
    description: roomFields.description.default(null),
    maxAdults: roomFields.maxAdults,
    maxChildren: roomFields.maxChildren.default(0),
    maxGuests: roomFields.maxGuests,
    beds: roomFields.beds.default([]),
    amenities: roomFields.amenities.default([]),
    photoUrls: roomFields.photoUrls.default([]),
    active: roomFields.active.default(true),
  })
  .refine(validCapacity, { message: "maxGuests must be between maxAdults and total capacity.", path: ["maxGuests"] });

export const updateRoomSchema = z
  .object(roomFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field must be provided.");

const rateFields = {
  planCode: z.string().trim().min(1).max(40),
  planName: z.string().trim().min(1).max(120),
  mealPlan: mealPlanSchema,
  start: isoDateSchema,
  endInclusive: isoDateSchema,
  nightlyBaseCents: z.number().int().nonnegative().max(100_000_000),
  currency: z.literal("EUR"),
  includedAdults: z.number().int().nonnegative().max(20),
  includedChildren: z.number().int().nonnegative().max(20),
  extraAdultCents: z.number().int().nonnegative().max(100_000_000),
  extraChildCents: z.number().int().nonnegative().max(100_000_000),
  breakfastAdultCents: z.number().int().nonnegative().max(100_000_000),
  breakfastChildCents: z.number().int().nonnegative().max(100_000_000),
  maxChildAge: z.number().int().min(0).max(17),
  minNights: z.number().int().positive().max(365),
  active: z.boolean(),
};

export const createRatePeriodSchema = z
  .object({
    planCode: rateFields.planCode,
    planName: rateFields.planName,
    mealPlan: rateFields.mealPlan.default("room_only"),
    start: rateFields.start,
    endInclusive: rateFields.endInclusive,
    nightlyBaseCents: rateFields.nightlyBaseCents,
    currency: rateFields.currency.default("EUR"),
    includedAdults: rateFields.includedAdults.default(2),
    includedChildren: rateFields.includedChildren.default(0),
    extraAdultCents: rateFields.extraAdultCents.default(0),
    extraChildCents: rateFields.extraChildCents.default(0),
    breakfastAdultCents: rateFields.breakfastAdultCents.default(0),
    breakfastChildCents: rateFields.breakfastChildCents.default(0),
    maxChildAge: rateFields.maxChildAge.default(17),
    minNights: rateFields.minNights.default(1),
    active: rateFields.active.default(true),
  })
  .refine(({ start, endInclusive }) => start <= endInclusive, {
    message: "endInclusive must be on or after start.",
    path: ["endInclusive"],
  });

export const updateRatePeriodSchema = z
  .object(rateFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field must be provided.")
  .refine(
    ({ start, endInclusive }) => start === undefined || endInclusive === undefined || start <= endInclusive,
    { message: "endInclusive must be on or after start.", path: ["endInclusive"] },
  );

export const previewRateSchema = z
  .object({
    planCode: rateFields.planCode,
    checkIn: isoDateSchema,
    checkOut: isoDateSchema,
    occupancy: occupancySchema,
  })
  .refine(({ checkIn, checkOut }) => checkIn < checkOut, {
    message: "checkOut must be later than checkIn.",
    path: ["checkOut"],
  });

export const roomParamsSchema = z.object({ roomId: z.uuid() });
export const ratePeriodParamsSchema = roomParamsSchema.extend({ ratePeriodId: z.uuid() });

export function inclusiveToExclusive(date: string): string {
  return epochDayToDate(dateToEpochDay(date) + 1);
}

export function exclusiveToInclusive(date: string): string {
  return epochDayToDate(dateToEpochDay(date) - 1);
}

function validCapacity(value: { maxAdults: number; maxChildren: number; maxGuests: number }): boolean {
  return value.maxGuests >= value.maxAdults && value.maxGuests <= value.maxAdults + value.maxChildren;
}
