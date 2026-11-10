import { z } from "zod";
import { isoDateSchema } from "./common.js";
import { mealPlanSchema, occupancySchema } from "./entities.js";
import { MAX_RESERVATION_OFFERS, reservationOfferInputSchema } from "./offers.js";

export const manualRequestSourceSchema = z.enum(["phone", "walk_in", "other"]);
export type ManualRequestSource = z.infer<typeof manualRequestSourceSchema>;

export const manualInquiryInputSchema = z.object({
  guest: z.object({
    name: z.string().trim().min(1, "Enter the guest’s name.").max(160),
    email: z.email("Enter a valid email address.").max(320).nullable().default(null),
    phone: z.string().trim().min(5, "Enter a valid phone number.").max(50).nullable().default(null),
    language: z.string().trim().min(2).max(16).default("it"),
  }).strict(),
  checkIn: isoDateSchema,
  checkOut: isoDateSchema,
  occupancy: occupancySchema.extend({
    adults: occupancySchema.shape.adults.max(50),
    childAges: occupancySchema.shape.childAges.unwrap().max(20).default([]),
  }),
  mealPlan: mealPlanSchema,
  note: z.string().trim().max(2_000).default(""),
  receivedVia: manualRequestSourceSchema.default("phone"),
  sendOffer: z.boolean().default(false),
  offers: z.array(reservationOfferInputSchema).min(1).max(MAX_RESERVATION_OFFERS).optional(),
}).strict().refine(({ checkIn, checkOut }) => checkIn < checkOut, {
  message: "Check-out must be after check-in.", path: ["checkOut"],
}).refine(({ sendOffer, guest }) => !sendOffer || guest.email !== null || guest.phone !== null, {
  message: "Add an email or WhatsApp number to send an offer.", path: ["guest", "email"],
}).refine(({ sendOffer, guest }) => !sendOffer || guest.phone === null
  || /^\+[1-9]\d{6,14}$/.test(guest.phone.replace(/[\s().-]/g, "").replace(/^00/, "+")), {
  message: "Include a valid country code for WhatsApp, e.g. +39 333 123 4567.", path: ["guest", "phone"],
});

export type ManualInquiryInput = z.infer<typeof manualInquiryInputSchema>;
export type ManualInquiryResult = {
  inquiryId: string;
  reservationNumber: string;
  automated: boolean;
  attentionReason: string | null;
  deliveriesScheduled: number;
  replayed: boolean;
};
