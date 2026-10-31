import {
  createHotelInputSchema,
  deleteHotelInputSchema,
  loginInputSchema,
  registerInputSchema,
  updateHotelInputSchema,
} from "@hotel/contracts";

export const registerSchema = registerInputSchema;
export const loginSchema = loginInputSchema;
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
