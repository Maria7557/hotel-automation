import { z } from "zod";
import { isoDateSchema } from "./common.js";
import { mealPlanSchema, occupancySchema } from "./entities.js";

export const enquiryDateRangeSchema = z.object({ checkIn: isoDateSchema, checkOut: isoDateSchema })
  .refine(({ checkIn, checkOut }) => checkIn < checkOut, { message: "Check-out must be after check-in.", path: ["checkOut"] });
export const enquiryRoomSchema = z.object({
  mealPlan: mealPlanSchema,
  occupancy: occupancySchema.extend({ adults: z.number().int().min(1).max(50), childAges: z.array(z.number().int().min(0).max(17)).max(20).default([]) }),
});
export const enquiryDetailsSchema = z.object({
  firstName: z.string().trim().min(1, "Enter the guest’s first name.").max(80).optional(),
  lastName: z.string().trim().min(1, "Enter the guest’s last name.").max(80).optional(),
  alternativeDates: z.array(enquiryDateRangeSchema).max(3).optional(),
  additionalRooms: z.array(enquiryRoomSchema).max(5).optional(),
  consents: z.object({ privacy: z.boolean(), marketing: z.boolean() }).optional(),
});
export type EnquiryDetails = z.infer<typeof enquiryDetailsSchema>;
export function enquiryNeedsReview(details?: EnquiryDetails | null): boolean {
  return !!(details?.alternativeDates?.length || details?.additionalRooms?.length);
}
