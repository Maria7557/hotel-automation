import { z } from "zod";
import { mealPlanSchema } from "@hotel/contracts";

export const allowedMessageVariables = [
  "guest_name",
  "hotel_name",
  "check_in",
  "check_out",
  "guest_count",
  "meal_plan",
  "total",
  "offer_url",
] as const;

const allowedVariableSet = new Set<string>(allowedMessageVariables);
const variablePattern = /{{\s*([a-z_][a-z0-9_]*)\s*}}/g;

function messageTemplate(maxLength: number, singleLine = false) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .superRefine((value, context) => {
      if (singleLine && /[\r\n]/.test(value)) {
        context.addIssue({ code: "custom", message: "The subject must be one line." });
      }
      const variables = [...value.matchAll(variablePattern)].map((match) => match[1]);
      for (const variable of variables) {
        if (variable && !allowedVariableSet.has(variable)) {
          context.addIssue({ code: "custom", message: `Unknown template variable: ${variable}.` });
        }
      }
      if (value.replace(variablePattern, "").includes("{{") || value.replace(variablePattern, "").includes("}}")) {
        context.addIssue({ code: "custom", message: "Malformed template variable." });
      }
    });
}

const templatesSchema = z.object({
  emailSubjectTemplate: messageTemplate(160, true),
  emailBodyTemplate: messageTemplate(5_000),
  whatsappBodyTemplate: messageTemplate(2_000),
});

export const messageSettingsInputSchema = templatesSchema.extend({
  templateLanguage: z.enum(["en", "it"]).optional(),
  translations: z.partialRecord(z.enum(["en", "it"]), templatesSchema).optional(),
});

export const previewSampleSchema = z.object({
  language: z.enum(["en", "it"]).optional(),
  guestName: z.string().trim().min(1).max(160).default("Mario Rossi"),
  checkIn: z.iso.date().default("2027-06-10"),
  checkOut: z.iso.date().default("2027-06-12"),
  guestCount: z.number().int().min(1).max(20).default(2),
  mealPlan: mealPlanSchema.default("BB"),
  totalCents: z.number().int().nonnegative().max(100_000_000).default(24_000),
});

export const previewInputSchema = z.object({
  channel: z.enum(["email", "whatsapp"]),
  sample: previewSampleSchema.optional(),
});

export const testSendInputSchema = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal("email"),
    recipient: z.email().max(320),
    sample: previewSampleSchema.optional(),
  }),
  z.object({
    channel: z.literal("whatsapp"),
    recipient: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "Use an E.164 phone number."),
    sample: previewSampleSchema.optional(),
  }),
]);

export const googleCallbackQuerySchema = z.object({
  state: z.string().min(20).max(2_048),
  code: z.string().min(1).max(4_096),
});
