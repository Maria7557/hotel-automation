import { resolveLanguage, translate, validationMessage } from "@hotel/i18n";
import { monitoringError, observe } from "@hotel/monitoring";
import { attachMonitoring, monitoredProviderFetch } from "./monitoring/index.js";
import { monitoredService } from "./monitoring/workflows.js";
import { registerClientRoutes } from "./http/routes/clients.js";
import type { ClientRepository } from "./repositories/clients.js";
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
import { registerPlatformWhatsAppAdminRoutes } from "./http/routes/platform-whatsapp-admin.js";
import { safeRequest, safeResponse, safeError, safeLogFields } from "./safe-logging.js";
import { registerUiDiagnostics } from "./http/routes/ui-diagnostics.js";
import { registerNotificationRoutes } from "./http/routes/notifications.js";
import { AppError } from "./lib/errors.js";
import { GoogleProvider } from "./providers/google.js";
import { MicrosoftProvider } from "./providers/microsoft.js";
import { SmtpProvider } from "./providers/smtp.js";
import { ExpoPushProvider, SmtpNotificationMailer } from "./providers/notifications.js";
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
import { PlatformWhatsAppAdminService } from "./services/platform-whatsapp-admin.js";
import { NotificationService } from "./services/notifications.js";
import type { PlatformNotificationMailer } from "./services/notifications.js";

type AppOptions = {
  env: Pick<AppEnv, "AUTH_SECRET" | "SESSION_TTL_DAYS" | "corsOrigins"> &
    Partial<
      Pick<
        AppEnv,
        "NODE_ENV" | "SIGNAL_ENDPOINT" | "SIGNAL_WRITE_KEY_DEVELOPMENT" | "SIGNAL_WRITE_KEY_PRODUCTION" | "SIGNAL_PUBLIC_WRITE_KEY_DEVELOPMENT" | "SIGNAL_PUBLIC_WRITE_KEY_PRODUCTION" | "SIGNAL_RELEASE" | "SIGNAL_API_RELEASE" | "SIGNAL_WORKER_RELEASE" | "PUBLIC_BASE_URL" | "APP_BASE_URL" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GOOGLE_REDIRECT_URI" |
        "GOOGLE_AUTH_CLIENT_IDS" | "APPLE_AUTH_CLIENT_IDS" | "WAHA_BASE_URL" | "WAHA_API_KEY" |
        "MICROSOFT_CLIENT_ID" | "MICROSOFT_CLIENT_SECRET" | "MICROSOFT_REDIRECT_URI" | "platformAdminEmails" |
        "EXPO_ACCESS_TOKEN" | "NOTIFICATION_SMTP_HOST" | "NOTIFICATION_SMTP_PORT" |
        "NOTIFICATION_SMTP_USERNAME" | "NOTIFICATION_SMTP_PASSWORD" | "NOTIFICATION_FROM_EMAIL" | "NOTIFICATION_FROM_NAME"
      >
    >;
  repositories: Repositories;
  clients?: ClientRepository;
  providerFetch?: ProviderFetch;
  socialTokenVerifier?: SocialTokenVerifier;
  passwordResetMailer?: PlatformNotificationMailer;
  logger?: boolean;
};

export async function createApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    // The deployed nginx proxy is local; remote clients cannot supply a trusted IP chain.
    trustProxy: ["127.0.0.1", "::1"],
    logger: options.logger
      ? {
          hooks: {
            logMethod(args, method) {
              if (args[0] && typeof args[0] === "object") method.call(this, safeLogFields(args[0]), "Application event");
              else method.call(this, "Application event");
            },
          },
          serializers: { req: safeRequest, res: safeResponse, err: safeError },
        }
      : false,
    bodyLimit: 128 * 1_024,
  });

  app.decorateRequest("currentUser", null);
  app.decorateRequest("accessToken", null);
  const signalMonitor = attachMonitoring(app, options.env, (userId) => options.repositories.hotels.findForUser(userId));

  await app.register(cors, {
    origin: options.env.corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(cookie);
  await app.register(formbody);

  const platformMailer = monitoredService(signalMonitor, new SmtpNotificationMailer({
    host: options.env.NOTIFICATION_SMTP_HOST,
    port: options.env.NOTIFICATION_SMTP_PORT,
    username: options.env.NOTIFICATION_SMTP_USERNAME,
    password: options.env.NOTIFICATION_SMTP_PASSWORD,
    fromEmail: options.env.NOTIFICATION_FROM_EMAIL,
    fromName: options.env.NOTIFICATION_FROM_NAME,
  }), { send: "provider.notification_email.send" }, "notificationMailer");
  const authService = monitoredService(signalMonitor, new AuthService(
    options.repositories.auth,
    options.env.AUTH_SECRET,
    options.env.SESSION_TTL_DAYS,
    options.socialTokenVerifier ?? new RemoteSocialTokenVerifier({
      google: socialClientIds(options.env.GOOGLE_AUTH_CLIENT_IDS),
      apple: socialClientIds(options.env.APPLE_AUTH_CLIENT_IDS),
    }),
    {
      mailer: options.passwordResetMailer ?? platformMailer,
      appBaseUrl: options.env.APP_BASE_URL ?? options.env.PUBLIC_BASE_URL ?? "http://localhost:8081",
      onDeliveryError: () => {
        app.log.error("Password recovery email could not be delivered.");
        observe(() => signalMonitor?.error("auth.recovery.delivery_failed", monitoringError(null), { placement: "auth.recovery" }));
      },
    },
  ), { register: "account.register", login: "account.login", socialLogin: "account.social_login", resetPassword: "account.password_reset", logout: "account.logout" }, "auth");
  app.addHook("onClose", () => authService.finishPendingEmails());
  const hotelService = monitoredService(signalMonitor, new HotelService(options.repositories.hotels), { create: "hotel.create", update: "hotel.update", remove: "hotel.delete", updateIntakeSettings: "hotel.intake_settings.update" }, "hotels");
  const inventoryService = monitoredService(signalMonitor, new InventoryService(options.repositories.inventory), {
    createRoom: "room.create", updateRoom: "room.update", deleteRoom: "room.delete", createRatePeriod: "rate.create", updateRatePeriod: "rate.update", deleteRatePeriod: "rate.delete",
  }, "inventory");
  const notificationService = new NotificationService(
    options.repositories.notifications,
    new ExpoPushProvider(monitoredProviderFetch(signalMonitor, options.providerFetch ?? fetch, "expo"), options.env.EXPO_ACCESS_TOKEN),
    platformMailer,
  );
  const automationService = monitoredService(signalMonitor, new AutomationService(
    options.repositories.automation,
    options.env.AUTH_SECRET,
    options.env.PUBLIC_BASE_URL ?? "http://localhost:4000",
    notificationService,
    signalMonitor,
  ), { intake: "inquiry.submit", createFormInquiry: "inquiry.form.submit", createManualInquiry: "reservation.create", sendReservationOffers: "offer.send", acceptProposal: "offer.accept", markPaymentLinkSent: "payment_link.record", markManualOfferSent: "offer.manual_delivery.record", saveOfferSettings: "offer_settings.update" }, "automation");
  const channelService = new ChannelService(
    options.repositories.channels,
    options.repositories.hotels,
    options.env.AUTH_SECRET,
    automationService,
    {
      ...(options.env.GOOGLE_CLIENT_ID ? { GOOGLE_CLIENT_ID: options.env.GOOGLE_CLIENT_ID } : {}),
      ...(options.env.GOOGLE_CLIENT_SECRET
        ? { GOOGLE_CLIENT_SECRET: options.env.GOOGLE_CLIENT_SECRET }
        : {}),
      ...(options.env.GOOGLE_REDIRECT_URI
        ? { GOOGLE_REDIRECT_URI: options.env.GOOGLE_REDIRECT_URI }
        : {}),
    },
    new GoogleProvider(monitoredProviderFetch(signalMonitor, options.providerFetch ?? fetch, "google")),
    new WahaProvider(monitoredProviderFetch(signalMonitor, options.providerFetch ?? fetch, "waha")),
    {
      ...(options.env.WAHA_BASE_URL ? { baseUrl: options.env.WAHA_BASE_URL } : {}),
      ...(options.env.WAHA_API_KEY ? { apiKey: options.env.WAHA_API_KEY } : {}),
    },
    options.env,
    new MicrosoftProvider(monitoredProviderFetch(signalMonitor, options.providerFetch ?? fetch, "microsoft")),
    monitoredService(signalMonitor, new SmtpProvider(), { send: "provider.smtp.send" }, "smtpProvider"),
  );
  const mailService = new MailConnectionService(
    options.repositories.channels, options.repositories.hotels, options.env.AUTH_SECRET, options.env,
    new GoogleProvider(monitoredProviderFetch(signalMonitor, options.providerFetch ?? fetch, "google")), new MicrosoftProvider(monitoredProviderFetch(signalMonitor, options.providerFetch ?? fetch, "microsoft")), monitoredService(signalMonitor, new SmtpProvider(), { send: "provider.smtp.send" }, "smtpProvider"),
  );
  const platformWhatsAppAdminService = new PlatformWhatsAppAdminService(
    options.repositories.platformAdmin,
    new WahaProvider(monitoredProviderFetch(signalMonitor, options.providerFetch ?? fetch, "waha")),
    {
      ...(options.env.WAHA_BASE_URL ? { baseUrl: options.env.WAHA_BASE_URL } : {}),
      ...(options.env.WAHA_API_KEY ? { apiKey: options.env.WAHA_API_KEY } : {}),
    },
    options.env.platformAdminEmails ?? [],
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
  await registerPlatformWhatsAppAdminRoutes(app, authService, platformWhatsAppAdminService);
  await registerNotificationRoutes(app, authService, notificationService);
  await registerUiDiagnostics(app, authService, options.env);
  await registerHotelRoutes(app, authService, hotelService);
  await registerInventoryRoutes(app, authService, inventoryService);
  await registerMediaRoutes(app, authService, options.env.PUBLIC_BASE_URL);
  await registerAutomationRoutes(app, authService, automationService);
  await registerEmbedRoutes(app, options.repositories.automation);
  if (options.clients) await registerClientRoutes(app, authService, options.clients);

  app.setNotFoundHandler(async (request, reply) => {
    return reply.code(404).send({ error: { code: "NOT_FOUND", message: translate(resolveLanguage(request.headers["accept-language"]?.split(",")[0]), "Route was not found.") } });
  });

  app.setErrorHandler(async (error, request, reply) => {
    const language = resolveLanguage(request.headers["accept-language"]?.split(",")[0]);
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: translate(language, "Request validation failed."),
          details: error.issues.map((issue) => ({ path: issue.path.join("."), message: validationMessage(language, issue) })),
        },
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: translate(language, error.message), ...(error.details ? { details: error.details } : {}) },
      });
    }

    request.log.error({ err: error }, "Unhandled request error");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: translate(language, "Unexpected server error.") } });
  });

  return app;
}
