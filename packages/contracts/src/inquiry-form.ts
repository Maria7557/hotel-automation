import { z } from "zod";
import { isoDateSchema } from "./common.js";
import { DEFAULT_GUEST_LANGUAGE } from "./languages.js";
import { mealPlanSchema, occupancySchema } from "./entities.js";

export const inquiryFormInputSchema = z.object({
  guest: z.object({
    name: z.string().trim().min(1, "Enter the guest’s name.").max(160),
    email: z.email("Enter a valid email address.").nullable().default(null),
    phone: z.string().trim().min(5, "Enter a valid phone number.").max(50).nullable().default(null),
    language: z.string().trim().min(2).max(16).default(DEFAULT_GUEST_LANGUAGE),
  }),
  checkIn: isoDateSchema,
  checkOut: isoDateSchema,
  occupancy: occupancySchema,
  mealPlan: mealPlanSchema,
  note: z.string().trim().max(2_000).default(""),
}).strict().refine(({ checkIn, checkOut }) => checkIn < checkOut, {
  message: "Check-out must be after check-in.", path: ["checkOut"],
}).refine(({ guest }) => guest.email !== null || guest.phone !== null, {
  message: "Add an email or WhatsApp number.", path: ["guest", "email"],
});

export type InquiryFormInput = z.infer<typeof inquiryFormInputSchema>;

// The website widget and the in-app form validate the same guest and stay details.
export const publicInquirySchema = inquiryFormInputSchema.safeExtend({
  website: z.string().max(200).default(""),
  source: z.record(z.string(), z.unknown()).default({}),
});
