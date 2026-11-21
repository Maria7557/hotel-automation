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
  SIGNAL_ENDPOINT: optionalString,
  SIGNAL_WRITE_KEY_DEVELOPMENT: optionalString,
  SIGNAL_WRITE_KEY_PRODUCTION: optionalString,
  SIGNAL_PUBLIC_WRITE_KEY_DEVELOPMENT: optionalString,
  SIGNAL_PUBLIC_WRITE_KEY_PRODUCTION: optionalString,
  SIGNAL_RELEASE: optionalString,
  SIGNAL_API_RELEASE: optionalString,
  SIGNAL_WORKER_RELEASE: optionalString,
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4_000),
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  CORS_ORIGINS: z.string().default("http://localhost:8081,http://localhost:19006"),
  PUBLIC_BASE_URL: z.url().default("http://localhost:4000"),
  APP_BASE_URL: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol),
    "APP_BASE_URL must use HTTP or HTTPS.").default("http://localhost:8081"),
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
  EXPO_ACCESS_TOKEN: optionalString,
  NOTIFICATION_SMTP_HOST: optionalString,
  NOTIFICATION_SMTP_PORT: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.coerce.number().int().min(1).max(65_535).optional(),
  ),
  NOTIFICATION_SMTP_USERNAME: optionalString,
  NOTIFICATION_SMTP_PASSWORD: optionalString,
  NOTIFICATION_FROM_EMAIL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.email().optional(),
  ),
  NOTIFICATION_FROM_NAME: optionalString,
  CLIENT_WORKER_INTERVAL_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),
  CLIENT_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(25).default(25),
  DELIVERY_WORKER_ENABLED: booleanFromString,
  DELIVERY_WORKER_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(5_000),
  DELIVERY_WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
}).superRefine((env, context) => {
  if (env.NODE_ENV === "production" && new URL(env.APP_BASE_URL).protocol !== "https:") {
    context.addIssue({ code: "custom", path: ["APP_BASE_URL"], message: "APP_BASE_URL must use HTTPS in production." });
  }
});

export type AppEnv = z.infer<typeof envSchema> & { corsOrigins: string[]; platformAdminEmails: string[] };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  // Older production deployments entered only the canonical public HTTPS URL.
  // Keep explicit APP_BASE_URL authoritative and run normal validation on the fallback.
  const parsed = envSchema.parse({
    ...source,
    APP_BASE_URL: source.APP_BASE_URL ?? (source.NODE_ENV === "production" ? source.PUBLIC_BASE_URL : undefined),
  });

  return {
    ...parsed,
    // Production previously used one private server key. Never copy it to a
    // public client, or use it as a fallback outside production.
    SIGNAL_WRITE_KEY_PRODUCTION: parsed.SIGNAL_WRITE_KEY_PRODUCTION ??
      (parsed.NODE_ENV === "production" ? optionalString.parse(source.SIGNAL_WRITE_KEY) : undefined),
    corsOrigins: parsed.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    platformAdminEmails: parsed.PLATFORM_ADMIN_EMAILS.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  };
}
