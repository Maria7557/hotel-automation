import { z } from "zod";

export const registerInputSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(10).max(128),
  displayName: z.string().trim().min(1).max(120).nullable().default(null),
});

export const loginInputSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(128),
});

export const publicUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string().nullable(),
});

export const authResultSchema = z.object({
  accessToken: z.string().min(32),
  expiresAt: z.iso.datetime({ offset: true }),
  user: publicUserSchema,
});

const nullableUrl = z.url().max(2_048).nullable();
const nullableEmail = z.email().max(320).nullable();

export const hotelProfileFields = {
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(120),
  countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  locale: z.string().trim().min(2).max(16),
  description: z.string().trim().max(3_000).nullable(),
  currency: z.literal("EUR"),
  timezone: z.string().trim().max(64),
  email: nullableEmail,
  phone: z.string().trim().min(3).max(50).nullable(),
  website: nullableUrl,
  logoUrl: nullableUrl,
  photoUrls: z.array(z.url().max(2_048)).max(20),
  termsText: z.string().trim().max(5_000).nullable(),
};

export const createHotelInputSchema = z.object({
  name: hotelProfileFields.name,
  city: hotelProfileFields.city,
  countryCode: hotelProfileFields.countryCode.default("IT"),
  locale: hotelProfileFields.locale.default("en-GB"),
  description: hotelProfileFields.description.default(null),
  currency: hotelProfileFields.currency.default("EUR"),
  timezone: hotelProfileFields.timezone.default("Europe/Rome"),
  email: hotelProfileFields.email.default(null),
  phone: hotelProfileFields.phone.default(null),
  website: hotelProfileFields.website.default(null),
  logoUrl: hotelProfileFields.logoUrl.default(null),
  photoUrls: hotelProfileFields.photoUrls.default([]),
  termsText: hotelProfileFields.termsText.default(null),
});

export const updateHotelInputSchema = z
  .object(hotelProfileFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field must be provided.");

export const deleteHotelInputSchema = z.object({
  confirmName: z.string().min(1).max(120),
});

export const hotelProfileApiSchema = z.object({
  id: z.uuid(),
  ...hotelProfileFields,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type RegisterInput = z.infer<typeof registerInputSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type AuthResult = z.infer<typeof authResultSchema>;
export type CreateHotelInput = z.infer<typeof createHotelInputSchema>;
export type UpdateHotelInput = z.infer<typeof updateHotelInputSchema>;
export type HotelProfileApi = z.infer<typeof hotelProfileApiSchema>;
