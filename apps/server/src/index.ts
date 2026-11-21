import { createWorkerMonitor, monitoredLogger, monitoredProviderFetch } from "./monitoring/index.js";
import { monitoredService } from "./monitoring/workflows.js";
import { monitoringError, observe } from "@hotel/monitoring";
import { createClientConnection, PostgresClientRepository } from "./repositories/clients.js";
import "dotenv/config";

import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { GoogleProvider } from "./providers/google.js";
import { WahaProvider } from "./providers/waha.js";
import { MicrosoftProvider } from "./providers/microsoft.js";
import { SmtpProvider } from "./providers/smtp.js";
import { ExpoPushProvider, SmtpNotificationMailer } from "./providers/notifications.js";
import { createPostgresRepositories } from "./repositories/postgres.js";
import { DeliveryWorker, DeliveryWorkerLoop } from "./services/delivery-worker.js";
import { NotificationService } from "./services/notifications.js";

const env = loadEnv();
const { client, db } = createDatabase(env.DATABASE_URL);
const repositories = createPostgresRepositories(db);
const clientConnection = createClientConnection(env.DATABASE_URL);
const app = await createApp({ env, repositories, clients: new PostgresClientRepository(clientConnection), logger: true });
const workerMonitor = env.DELIVERY_WORKER_ENABLED ? createWorkerMonitor(env, "ospio-delivery-worker") : null;
const workerLogger = monitoredLogger(app.log, workerMonitor, "deliveryWorker");
const notificationService = new NotificationService(
  repositories.notifications,
  new ExpoPushProvider(monitoredProviderFetch(workerMonitor, fetch, "expo"), env.EXPO_ACCESS_TOKEN),
  monitoredService(workerMonitor, new SmtpNotificationMailer({
    host: env.NOTIFICATION_SMTP_HOST,
    port: env.NOTIFICATION_SMTP_PORT,
    username: env.NOTIFICATION_SMTP_USERNAME,
    password: env.NOTIFICATION_SMTP_PASSWORD,
    fromEmail: env.NOTIFICATION_FROM_EMAIL,
    fromName: env.NOTIFICATION_FROM_NAME,
  }), { send: "provider.notification_email.send" }, "notificationMailer"),
);
const worker = new DeliveryWorker(
  repositories.deliveryWorker,
  repositories.channels,
  env.AUTH_SECRET,
  {
    ...(env.GOOGLE_CLIENT_ID ? { GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID } : {}),
    ...(env.GOOGLE_CLIENT_SECRET ? { GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET } : {}),
    ...(env.GOOGLE_REDIRECT_URI ? { GOOGLE_REDIRECT_URI: env.GOOGLE_REDIRECT_URI } : {}),
  },
  new GoogleProvider(monitoredProviderFetch(workerMonitor, fetch, "google")),
  new WahaProvider(monitoredProviderFetch(workerMonitor, fetch, "waha")),
  env.DELIVERY_WORKER_MAX_ATTEMPTS,
  workerLogger,
  {
    ...(env.WAHA_BASE_URL ? { baseUrl: env.WAHA_BASE_URL } : {}),
    ...(env.WAHA_API_KEY ? { apiKey: env.WAHA_API_KEY } : {}),
  },
  {
    ...(env.MICROSOFT_CLIENT_ID ? { MICROSOFT_CLIENT_ID: env.MICROSOFT_CLIENT_ID } : {}),
    ...(env.MICROSOFT_CLIENT_SECRET ? { MICROSOFT_CLIENT_SECRET: env.MICROSOFT_CLIENT_SECRET } : {}),
    ...(env.MICROSOFT_REDIRECT_URI ? { MICROSOFT_REDIRECT_URI: env.MICROSOFT_REDIRECT_URI } : {}),
  },
  new MicrosoftProvider(monitoredProviderFetch(workerMonitor, fetch, "microsoft")),
  monitoredService(workerMonitor, new SmtpProvider(), { send: "provider.smtp.send" }, "smtpProvider"),
  notificationService,
  workerMonitor,
);
const workerLoop = env.DELIVERY_WORKER_ENABLED
  ? new DeliveryWorkerLoop(worker, env.DELIVERY_WORKER_INTERVAL_MS, 10, workerLogger)
  : null;

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "Shutting down");
  observe(() => app.signalMonitor?.info("server.shutdown.started", { placement: "server.shutdown" }));
  await workerLoop?.stop();
  await workerMonitor?.stop();
  await app.close();
  await clientConnection.end({ timeout: 3 });
  await client.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
  workerLoop?.start();
  observe(() => app.signalMonitor?.info("server.startup.completed", { placement: "server.bootstrap" }));
} catch (error) {
  app.log.error(error);
  observe(() => app.signalMonitor?.error("server.startup.failed", monitoringError(error), { placement: "server.bootstrap" }));
  await clientConnection.end({ timeout: 3 });
  await client.end();
  process.exit(1);
}
