import {
  createHotelInputSchema,
  deleteHotelInputSchema,
  loginInputSchema,
  registerInputSchema,
  updateHotelInputSchema,
} from "@hotel/contracts";
import { z } from "zod";

export const registerSchema = registerInputSchema;
export const loginSchema = loginInputSchema;
export const socialLoginSchema = z.object({
  provider: z.enum(["google", "apple"]),
  idToken: z.string().min(20).max(20_000),
});
export const createHotelSchema = createHotelInputSchema.refine(
  ({ timezone }) => isTimeZone(timezone),
  { message: "Unknown IANA time zone.", path: ["timezone"] },
);
export const updateHotelSchema = updateHotelInputSchema.refine(
  ({ timezone }) => timezone === undefined || isTimeZone(timezone),
  { message: "Unknown IANA time zone.", path: ["timezone"] },
);
export const deleteHotelSchema = deleteHotelInputSchema;

function isTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
