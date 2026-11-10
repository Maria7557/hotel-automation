import { z } from "zod";

export const MAX_RESERVATION_OFFERS = 6;
export const OFFER_VALIDITY_MS = 7 * 24 * 60 * 60 * 1_000;
export const reservationOfferStatusSchema = z.enum(["available", "expired", "accepted"]);
export type ReservationOfferStatus = z.infer<typeof reservationOfferStatusSchema>;

export const reservationOfferInputSchema = z.object({
  roomId: z.uuid(),
  planName: z.string().trim().min(1).max(160),
  totalCents: z.number().int().min(0).max(999_999_999),
  note: z.string().trim().max(2_000).default(""),
}).strict();

export const sendReservationOffersSchema = z.object({
  // Prevent an editor from replacing a newer offer sent by another staff member.
  baseOfferId: z.uuid().nullable(),
  offers: z.array(reservationOfferInputSchema).min(1).max(MAX_RESERVATION_OFFERS),
}).strict();
export type SendReservationOffersInput = z.infer<typeof sendReservationOffersSchema>;

export type ReservationOffer = z.infer<typeof reservationOfferInputSchema> & {
  id: string;
  roomName: string;
  mealPlan: "BB" | "HB" | "FB" | null;
  currency: string;
  status: ReservationOfferStatus;
  expiresAt: string;
};
