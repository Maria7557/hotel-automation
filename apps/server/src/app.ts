import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";

import type { AppEnv } from "./config/env.js";
import { registerAuthRoutes } from "./http/routes/auth.js";
import { registerChannelRoutes } from "./http/routes/channels.js";
import { registerAutomationRoutes } from "./http/routes/automation.js";
import { registerEmbedRoutes } from "./http/routes/embed.js";
import { registerHotelRoutes } from "./http/routes/hotels.js";
import { registerInventoryRoutes } from "./http/routes/inventory.js";
import { AppError } from "./lib/errors.js";
import { GoogleProvider } from "./providers/google.js";
import type { ProviderFetch } from "./providers/http.js";
import { WahaProvider } from "./providers/waha.js";
import type { Repositories } from "./repositories/types.js";
import { AuthService } from "./services/auth.js";
import { AutomationService } from "./services/automation.js";
import { ChannelService } from "./services/channels.js";
import { HotelService } from "./services/hotels.js";
import { InventoryService } from "./services/inventory.js";

type AppOptions = {
  env: Pick<AppEnv, "AUTH_SECRET" | "SESSION_TTL_DAYS" | "corsOrigins"> &
    Partial<
      Pick<
        AppEnv,
        "PUBLIC_BASE_URL" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GOOGLE_REDIRECT_URI"
      >
    >;
  repositories: Repositories;
  providerFetch?: ProviderFetch;
  logger?: boolean;
};

export async function createApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger
      ? {
          redact: [
            "req.headers.authorization",
            "req.body.password",
            "req.body.apiKey",
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
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(formbody);

  const authService = new AuthService(
    options.repositories.auth,
    options.env.AUTH_SECRET,
    options.env.SESSION_TTL_DAYS,
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
  );

  app.get("/health", async (_request, reply) => {
    const database = await options.repositories.system.checkDatabase();
    return reply.code(database ? 200 : 503).send({
      status: database ? "ok" : "degraded",
      dependencies: { database: database ? "up" : "down" },
      timestamp: new Date().toISOString(),
    });
  });

  await registerAuthRoutes(app, authService);
  await registerChannelRoutes(app, authService, channelService);
  await registerHotelRoutes(app, authService, hotelService);
  await registerInventoryRoutes(app, authService, inventoryService);
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
