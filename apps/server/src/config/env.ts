import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);
const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.url().optional(),
);
const booleanFromString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4_000),
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  CORS_ORIGINS: z.string().default("http://localhost:8081,http://localhost:19006"),
  PUBLIC_BASE_URL: z.url().default("http://localhost:4000"),
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_REDIRECT_URI: optionalUrl,
  MICROSOFT_CLIENT_ID: optionalString,
  MICROSOFT_CLIENT_SECRET: optionalString,
  MICROSOFT_REDIRECT_URI: optionalUrl,
  GOOGLE_AUTH_CLIENT_IDS: optionalString,
  APPLE_AUTH_CLIENT_IDS: optionalString,
  WAHA_BASE_URL: optionalUrl,
  WAHA_API_KEY: optionalString,
  PLATFORM_ADMIN_EMAILS: z.string().default(""),
  DELIVERY_WORKER_ENABLED: booleanFromString,
  DELIVERY_WORKER_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(5_000),
  DELIVERY_WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
});

export type AppEnv = z.infer<typeof envSchema> & { corsOrigins: string[]; platformAdminEmails: string[] };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.parse(source);

  return {
    ...parsed,
    corsOrigins: parsed.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    platformAdminEmails: parsed.PLATFORM_ADMIN_EMAILS.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  };
}
