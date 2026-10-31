import { z } from "zod";
import {
  currencySchema,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  nonNegativeCentsSchema,
  nullableDateTimeSchema,
  photoSchema,
} from "./common.js";

export const hotelSchema = z.object({
  id: idSchema,
  ownerUserId: idSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(3_000).default(""),
  currency: currencySchema,
  timezone: z.string().trim().min(1).default("Europe/Rome"),
  locale: z.string().trim().min(2).default("en-GB"),
  email: z.email().nullable().default(null),
  phone: z.string().trim().min(5).max(40).nullable().default(null),
  websiteUrl: z.url().nullable().default(null),
  logoUrl: z.url().nullable().default(null),
  photos: z.array(photoSchema).default([]),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Hotel = z.infer<typeof hotelSchema>;

export const bedTypeSchema = z.enum([
  "single",
  "double",
  "queen",
  "king",
  "sofa_bed",
  "bunk",
  "crib",
]);

export const roomSchema = z
  .object({
    id: idSchema,
    hotelId: idSchema,
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(3_000).default(""),
    maxAdults: z.number().int().positive(),
    maxChildren: z.number().int().nonnegative(),
    maxGuests: z.number().int().positive(),
    beds: z
      .array(
        z.object({
          type: bedTypeSchema,
          count: z.number().int().positive(),
        }),
      )
      .default([]),
    amenities: z.array(z.string().trim().min(1).max(100)).default([]),
    photos: z.array(photoSchema).default([]),
    active: z.boolean().default(true),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .refine(({ maxAdults, maxGuests }) => maxGuests >= maxAdults, {
    message: "maxGuests cannot be lower than maxAdults",
    path: ["maxGuests"],
  });
export type Room = z.infer<typeof roomSchema>;

export const mealPlanSchema = z.enum(["room_only", "breakfast"]);

export const ratePeriodSchema = z
  .object({
    id: idSchema,
    hotelId: idSchema,
    roomId: idSchema,
    planCode: z.string().trim().min(1).max(80),
    planName: z.string().trim().min(1).max(120),
    start: isoDateSchema,
    endExclusive: isoDateSchema,
    nightlyBaseCents: nonNegativeCentsSchema,
    currency: currencySchema,
    mealPlan: mealPlanSchema,
    includedAdults: z.number().int().nonnegative().default(2),
    includedChildren: z.number().int().nonnegative().default(0),
    extraAdultCents: nonNegativeCentsSchema.default(0),
    extraChildCents: nonNegativeCentsSchema.default(0),
    maxChildAge: z.number().int().min(0).max(17).default(17),
    minNights: z.number().int().positive().default(1),
    active: z.boolean().default(true),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .refine(({ start, endExclusive }) => start < endExclusive, {
    message: "endExclusive must be later than start",
    path: ["endExclusive"],
  });
export type RatePeriod = z.infer<typeof ratePeriodSchema>;

export const occupancySchema = z.object({
  adults: z.number().int().positive(),
  childAges: z.array(z.number().int().min(0).max(17)).default([]),
});
export type Occupancy = z.infer<typeof occupancySchema>;

export const inquiryAttentionReasonSchema = z.enum([
  "no_matching_room",
  "missing_rate",
  "ambiguous_rate",
  "invalid_guest_data",
  "manual_review",
]);

export const inquirySchema = z
  .object({
    id: idSchema,
    hotelId: idSchema,
    externalKey: z.string().trim().min(1).max(200).nullable().default(null),
    guest: z.object({
      name: z.string().trim().min(1).max(160),
      email: z.email().nullable().default(null),
      phone: z.string().trim().min(5).max(40).nullable().default(null),
      language: z.string().trim().min(2).max(12).default("it"),
    }),
    checkIn: isoDateSchema,
    checkOut: isoDateSchema,
    occupancy: occupancySchema,
    note: z.string().trim().max(2_000).default(""),
    attentionReason: inquiryAttentionReasonSchema.nullable().default(null),
    createdAt: isoDateTimeSchema,
  })
  .refine(({ checkIn, checkOut }) => checkIn < checkOut, {
    message: "checkOut must be later than checkIn",
    path: ["checkOut"],
  })
  .refine(({ guest }) => guest.email !== null || guest.phone !== null, {
    message: "At least one guest contact is required",
    path: ["guest"],
  });
export type Inquiry = z.infer<typeof inquirySchema>;

export const offerNightSchema = z.object({
  date: isoDateSchema,
  ratePeriodId: idSchema,
  baseCents: nonNegativeCentsSchema,
  extraAdultCents: nonNegativeCentsSchema,
  extraChildCents: nonNegativeCentsSchema,
  totalCents: nonNegativeCentsSchema,
});

export const offerOptionSchema = z.object({
  roomId: idSchema,
  roomName: z.string().trim().min(1).max(160),
  planCode: z.string().trim().min(1).max(80),
  planName: z.string().trim().min(1).max(120),
  mealPlan: mealPlanSchema,
  currency: currencySchema,
  nights: z.array(offerNightSchema).min(1),
  totalCents: nonNegativeCentsSchema,
});

export const offerVersionSchema = z.object({
  id: idSchema,
  inquiryId: idSchema,
  version: z.number().int().positive(),
  publicTokenHash: z.string().trim().min(32),
  hotelSnapshot: z.object({
    name: z.string().trim().min(1).max(160),
    logoUrl: z.url().nullable().default(null),
  }),
  guestSnapshot: z.object({
    name: z.string().trim().min(1).max(160),
    checkIn: isoDateSchema,
    checkOut: isoDateSchema,
    occupancy: occupancySchema,
  }),
  options: z.array(offerOptionSchema).min(1),
  expiresAt: isoDateTimeSchema,
  acceptedAt: nullableDateTimeSchema,
  revokedAt: nullableDateTimeSchema,
  createdAt: isoDateTimeSchema,
});
export type OfferVersion = z.infer<typeof offerVersionSchema>;

export const deliveryChannelSchema = z.enum(["email", "whatsapp", "push"]);
export const deliveryPurposeSchema = z.enum([
  "offer",
  "test",
  "acceptance_notification",
]);
export const deliveryStatusSchema = z.enum([
  "queued",
  "sending",
  "sent",
  "failed",
]);

export const deliverySchema = z.object({
  id: idSchema,
  hotelId: idSchema,
  offerVersionId: idSchema.nullable().default(null),
  channel: deliveryChannelSchema,
  purpose: deliveryPurposeSchema,
  recipient: z.string().trim().min(1).max(320),
  status: deliveryStatusSchema,
  attempts: z.number().int().nonnegative().default(0),
  nextAttemptAt: nullableDateTimeSchema,
  sentAt: nullableDateTimeSchema,
  lastErrorCode: z.string().trim().max(120).nullable().default(null),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Delivery = z.infer<typeof deliverySchema>;
