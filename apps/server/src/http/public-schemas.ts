import { z } from "zod";
export { publicInquirySchema } from "@hotel/contracts";

export const publicHotelParamsSchema = z.object({ publicKey: z.uuid() });
export const publicOfferParamsSchema = z.object({ token: z.string().min(32).max(200) });
export const acceptOfferSchema = z.object({ option: z.coerce.number().int().min(0).default(0) });

const exactOrigin = z.string().url().refine((value) => {
  const url = new URL(value);
  return value === url.origin;
}, "Origin must contain only scheme, host, and optional port.");

export const intakeSettingsSchema = z.object({
  allowedOrigins: z.array(exactOrigin).max(20).transform((origins) => [...new Set(origins)]),
});
