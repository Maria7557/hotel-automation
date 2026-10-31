import { occupancySchema } from "@hotel/contracts";
import { z } from "zod";

const date = z.iso.date();

export const publicHotelParamsSchema = z.object({ publicKey: z.uuid() });
export const publicOfferParamsSchema = z.object({ token: z.string().min(32).max(200) });
export const acceptOfferSchema = z.object({ option: z.coerce.number().int().min(0).default(0) });

export const publicInquirySchema = z
  .object({
    guest: z.object({
      name: z.string().trim().min(1).max(160),
      email: z.email().nullable().default(null),
      phone: z.string().trim().min(5).max(50).nullable().default(null),
      language: z.string().trim().min(2).max(16).default("it"),
    }),
    checkIn: date,
    checkOut: date,
    occupancy: occupancySchema,
    note: z.string().trim().max(2_000).default(""),
    website: z.string().max(200).default(""),
    source: z.record(z.string(), z.unknown()).default({}),
  })
  .refine(({ checkIn, checkOut }) => checkIn < checkOut, {
    message: "checkOut must be later than checkIn",
    path: ["checkOut"],
  })
  .refine(({ guest }) => guest.email !== null || guest.phone !== null, {
    message: "At least one guest contact is required",
    path: ["guest"],
  });

const exactOrigin = z.string().url().refine((value) => {
  const url = new URL(value);
  return value === url.origin;
}, "Origin must contain only scheme, host, and optional port.");

export const intakeSettingsSchema = z.object({
  allowedOrigins: z.array(exactOrigin).max(20).transform((origins) => [...new Set(origins)]),
});
