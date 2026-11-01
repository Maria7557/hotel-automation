import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";

import type { AppEnv } from "./config/env.js";
import { registerAuthRoutes } from "./http/routes/auth.js";
import { registerChannelRoutes } from "./http/routes/channels.js";
import { registerMailConnectionRoutes } from "./http/routes/mail-connections.js";
import { registerAutomationRoutes } from "./http/routes/automation.js";
import { registerEmbedRoutes } from "./http/routes/embed.js";
import { registerHotelRoutes } from "./http/routes/hotels.js";
import { registerInventoryRoutes } from "./http/routes/inventory.js";
import { registerMediaRoutes } from "./http/routes/media.js";
import { AppError } from "./lib/errors.js";
import { GoogleProvider } from "./providers/google.js";
import { MicrosoftProvider } from "./providers/microsoft.js";
import { SmtpProvider } from "./providers/smtp.js";
import type { ProviderFetch } from "./providers/http.js";
import {
  RemoteSocialTokenVerifier,
  socialClientIds,
  type SocialTokenVerifier,
} from "./providers/social-auth.js";
import { WahaProvider } from "./providers/waha.js";
import type { Repositories } from "./repositories/types.js";
import { AuthService } from "./services/auth.js";
import { AutomationService } from "./services/automation.js";
import { ChannelService } from "./services/channels.js";
import { MailConnectionService } from "./services/mail-connections.js";
import { HotelService } from "./services/hotels.js";
import { InventoryService } from "./services/inventory.js";

type AppOptions = {
  env: Pick<AppEnv, "AUTH_SECRET" | "SESSION_TTL_DAYS" | "corsOrigins"> &
    Partial<
      Pick<
        AppEnv,
        "NODE_ENV" | "PUBLIC_BASE_URL" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GOOGLE_REDIRECT_URI" |
        "GOOGLE_AUTH_CLIENT_IDS" | "APPLE_AUTH_CLIENT_IDS" | "WAHA_BASE_URL" | "WAHA_API_KEY" |
        "MICROSOFT_CLIENT_ID" | "MICROSOFT_CLIENT_SECRET" | "MICROSOFT_REDIRECT_URI"
      >
    >;
  repositories: Repositories;
  providerFetch?: ProviderFetch;
  socialTokenVerifier?: SocialTokenVerifier;
  logger?: boolean;
};

export async function createApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger
      ? {
          redact: [
            "req.headers.authorization",
            "req.body.password",
            "req.body.idToken",
            "req.body.apiKey",
            "req.body.appPassword",
            "req.query.code",
            "res.headers['set-cookie']",
          ],
        }
      : false,
    bodyLimit: 128 * 1_024,
  });

  app.decorateRequest("currentUser", null);
  app.decorateRequest("accessToken", null);

  await app.register(cors, {
    origin: options.env.corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(cookie);
  await app.register(formbody);

  const authService = new AuthService(
    options.repositories.auth,
    options.env.AUTH_SECRET,
    options.env.SESSION_TTL_DAYS,
    options.socialTokenVerifier ?? new RemoteSocialTokenVerifier({
      google: socialClientIds(options.env.GOOGLE_AUTH_CLIENT_IDS),
      apple: socialClientIds(options.env.APPLE_AUTH_CLIENT_IDS),
    }),
  );
  const hotelService = new HotelService(options.repositories.hotels);
  const inventoryService = new InventoryService(options.repositories.inventory);
  const automationService = new AutomationService(
    options.repositories.automation,
    options.env.AUTH_SECRET,
    options.env.PUBLIC_BASE_URL ?? "http://localhost:4000",
  );
  const channelService = new ChannelService(
    options.repositories.channels,
    options.repositories.hotels,
    options.env.AUTH_SECRET,
    options.env.PUBLIC_BASE_URL ?? "http://localhost:4000",
    {
      ...(options.env.GOOGLE_CLIENT_ID ? { GOOGLE_CLIENT_ID: options.env.GOOGLE_CLIENT_ID } : {}),
      ...(options.env.GOOGLE_CLIENT_SECRET
        ? { GOOGLE_CLIENT_SECRET: options.env.GOOGLE_CLIENT_SECRET }
        : {}),
      ...(options.env.GOOGLE_REDIRECT_URI
        ? { GOOGLE_REDIRECT_URI: options.env.GOOGLE_REDIRECT_URI }
        : {}),
    },
    new GoogleProvider(options.providerFetch ?? fetch),
    new WahaProvider(options.providerFetch ?? fetch),
    {
      ...(options.env.WAHA_BASE_URL ? { baseUrl: options.env.WAHA_BASE_URL } : {}),
      ...(options.env.WAHA_API_KEY ? { apiKey: options.env.WAHA_API_KEY } : {}),
    },
  );
  const mailService = new MailConnectionService(
    options.repositories.channels, options.repositories.hotels, options.env.AUTH_SECRET, options.env,
    new GoogleProvider(options.providerFetch ?? fetch), new MicrosoftProvider(options.providerFetch ?? fetch), new SmtpProvider(),
  );

  app.get("/health", async (_request, reply) => {
    const database = await options.repositories.system.checkDatabase();
    return reply.code(database ? 200 : 503).send({
      status: database ? "ok" : "degraded",
      dependencies: { database: database ? "up" : "down" },
      timestamp: new Date().toISOString(),
    });
  });

  await registerAuthRoutes(app, authService, {
    secure: options.env.NODE_ENV === "production" || options.env.PUBLIC_BASE_URL?.startsWith("https://") === true,
  });
  await registerChannelRoutes(app, authService, channelService);
  await registerMailConnectionRoutes(app, authService, mailService);
  await registerHotelRoutes(app, authService, hotelService);
  await registerInventoryRoutes(app, authService, inventoryService);
  await registerMediaRoutes(app, authService, options.env.PUBLIC_BASE_URL);
  await registerAutomationRoutes(app, authService, automationService);
  await registerEmbedRoutes(app);

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route was not found." } });
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
      });
    }

    request.log.error({ err: error }, "Unhandled request error");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Unexpected server error." } });
  });

  return app;
}
