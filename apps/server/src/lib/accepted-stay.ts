import { isoDateSchema, mealPlanSchema, occupancySchema } from "@hotel/contracts";
import { z } from "zod";

const staySchema = z.object({ checkIn: isoDateSchema, checkOut: isoDateSchema, occupancy: occupancySchema, mealPlan: mealPlanSchema })
  .refine(({ checkIn, checkOut }) => checkIn < checkOut);

export function acceptedStay(snapshot: Record<string, unknown>, index: number) {
  const option: unknown = Array.isArray(snapshot.options) ? snapshot.options[index] : null;
  const parsed = staySchema.safeParse(option);
  return parsed.success ? parsed.data : null;
}
