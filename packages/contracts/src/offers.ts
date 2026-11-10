import { z } from "zod";
import { isoDateSchema } from "./common.js";
import { mealPlanSchema, occupancySchema } from "./entities.js";

export const MAX_RESERVATION_OFFERS = 6;
export const OFFER_VALIDITY_MS = 7 * 24 * 60 * 60 * 1_000;
export const reservationOfferStatusSchema = z.enum(["available", "expired", "accepted"]);
export type ReservationOfferStatus = z.infer<typeof reservationOfferStatusSchema>;

export const reservationOfferInputSchema = z.object({
  roomId: z.uuid(),
  planName: z.string().trim().min(1).max(160).optional(),
  planCode: z.string().trim().min(1).max(80).optional(),
  pricingMode: z.enum(["automatic", "manual"]).optional(),
  // Retained for older staff clients. The current editor always uses automatic pricing.
  totalCents: z.number().int().min(0).max(999_999_999).optional(),
  quotedTotalCents: z.number().int().min(0).max(999_999_999).optional(),
  checkIn: isoDateSchema.optional(),
  checkOut: isoDateSchema.optional(),
  occupancy: occupancySchema.optional(),
  mealPlan: mealPlanSchema.optional(),
  description: z.string().trim().max(2_000).optional(),
  extraIds: z.array(z.uuid()).max(50).refine((ids) => new Set(ids).size === ids.length, "Select each extra only once.").optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  depositPercent: z.number().min(0).max(100).optional(),
  cancellationPolicy: z.string().trim().max(4_000).optional(),
  note: z.string().trim().max(2_000).default(""),
}).strict().refine(({ checkIn, checkOut }) => !checkIn || !checkOut || checkIn < checkOut, {
  message: "Check-out must be after check-in.", path: ["checkOut"],
});

export const extraChargeModeSchema = z.enum(["per_stay", "per_night", "per_guest", "per_guest_per_night"]);
export type ExtraChargeMode = z.infer<typeof extraChargeModeSchema>;
export const offerExtraSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1_000).default(""),
  unitPriceCents: z.number().int().min(0).max(9_999_999),
  chargeMode: extraChargeModeSchema,
  active: z.boolean().default(true),
  defaultSelected: z.boolean().default(false),
}).strict();
export type OfferExtra = z.infer<typeof offerExtraSchema>;
export const offerSettingsSchema = z.object({
  extras: z.array(offerExtraSchema).max(50).default([]),
  defaultDepositPercent: z.number().min(0).max(100).default(30),
  cancellationPolicy: z.string().trim().max(4_000).default(""),
}).strict().refine(({ extras }) => new Set(extras.map(({ id }) => id)).size === extras.length, {
  message: "Each extra must have a unique ID.", path: ["extras"],
});
export type OfferSettings = z.infer<typeof offerSettingsSchema>;
export const offerExtraLineSchema = z.object({
  id: z.uuid(), name: z.string(), description: z.string(),
  unitPriceCents: z.number().int().nonnegative(), chargeMode: extraChargeModeSchema,
  quantity: z.number().int().positive(), totalCents: z.number().int().nonnegative(),
});
export type OfferExtraLine = z.infer<typeof offerExtraLineSchema>;
export type OfferQuote = {
  roomId: string; roomName: string; planCode: string; planName: string;
  checkIn: string; checkOut: string; occupancy: { adults: number; childAges: number[] };
  mealPlan: "BB" | "HB" | "FB"; currency: string; description: string; note: string;
  pricingSource: "rates" | "staff";
  accommodationCents: number; extras: OfferExtraLine[]; discountPercent: number;
  discountCents: number; totalCents: number; depositPercent: number; depositCents: number;
  cancellationPolicy: string;
};
export type OfferEditorData = {
  settings: OfferSettings;
  rooms: Array<{ id: string; name: string; maxAdults: number; maxChildren: number; maxGuests: number }>;
  plans: Array<{ roomId: string; planCode: string; planName: string; mealPlan: "BB" | "HB" | "FB" }>;
  suggestions: OfferQuote[];
};

export const sendReservationOffersSchema = z.object({
  // Prevent an editor from replacing a newer offer sent by another staff member.
  baseOfferId: z.uuid().nullable(),
  offers: z.array(reservationOfferInputSchema).min(1).max(MAX_RESERVATION_OFFERS),
}).strict();
export type SendReservationOffersInput = z.infer<typeof sendReservationOffersSchema>;

export type ReservationOffer = Partial<Omit<OfferQuote, "mealPlan">> & {
  id: string;
  roomId: string;
  roomName: string;
  planName: string;
  totalCents: number;
  note: string;
  mealPlan: "BB" | "HB" | "FB" | null;
  currency: string;
  status: ReservationOfferStatus;
  expiresAt: string;
};
