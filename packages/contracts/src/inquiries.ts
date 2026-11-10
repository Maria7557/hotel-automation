import { z } from "zod";
import { isoDateSchema } from "./common.js";
import { DEFAULT_GUEST_LANGUAGE } from "./languages.js";
import { mealPlanSchema, occupancySchema } from "./entities.js";
import { MAX_RESERVATION_OFFERS, reservationOfferInputSchema } from "./offers.js";

export const manualRequestSourceSchema = z.enum(["phone", "walk_in", "website", "email", "whatsapp", "other"]);
export type ManualRequestSource = z.infer<typeof manualRequestSourceSchema>;

export const manualInquiryInputSchema = z.object({
  guest: z.object({
    name: z.string().trim().min(1, "Enter the guest’s name.").max(160),
    email: z.email("Enter a valid email address.").max(320),
    phone: z.string({ error: "Enter the guest’s phone number." }).trim().min(1, "Enter the guest’s phone number.").max(50)
      .refine((phone) => !phone || /^\+[1-9]\d{6,14}$/.test(phone.replace(/[\s().-]/g, "").replace(/^00/, "+")),
        "Include the country code, e.g. +39 333 1234567."),
    language: z.string().trim().min(2).max(16).default(DEFAULT_GUEST_LANGUAGE),
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
