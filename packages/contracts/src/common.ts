import { z } from "zod";

export const idSchema = z.string().trim().min(1).max(128);

export const isoDateSchema = z.iso.date();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Use a three-letter ISO 4217 currency code")
  .default("EUR");

export const nonNegativeCentsSchema = z.number().int().nonnegative();

export const photoSchema = z.object({
  url: z.url(),
  alt: z.string().trim().min(1).max(240),
  sortOrder: z.number().int().nonnegative().default(0),
});

export const dateRangeSchema = z
  .object({
    start: isoDateSchema,
    endExclusive: isoDateSchema,
  })
  .refine(({ start, endExclusive }) => start < endExclusive, {
    message: "endExclusive must be later than start",
    path: ["endExclusive"],
  });

export const nullableDateTimeSchema = isoDateTimeSchema.nullable().default(null);
