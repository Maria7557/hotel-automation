import { z } from "zod";

export const detectMailSchema = z.object({ email: z.email().max(320) }).strict();
export const startMailOAuthSchema = z.object({ email: z.email().max(320) }).strict();
export const mailCallbackSchema = z.object({ state: z.string().max(2048), code: z.string().min(1).max(4096) }).strict();
export const smtpConnectSchema = z.object({
  email: z.email().max(320), hostname: z.string().min(4).max(253), port: z.union([z.literal(465), z.literal(587)]),
  username: z.string().min(1).max(320), appPassword: z.string().min(1).max(1024), encryption: z.enum(["tls", "starttls"]),
}).strict().superRefine((v, ctx) => { if ((v.port === 465 && v.encryption !== "tls") || (v.port === 587 && v.encryption !== "starttls")) ctx.addIssue({ code: "custom", message: "Encryption must match the selected port." }); });
