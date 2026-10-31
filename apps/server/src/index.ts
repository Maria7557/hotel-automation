import "dotenv/config";

import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { GoogleProvider } from "./providers/google.js";
import { WahaProvider } from "./providers/waha.js";
import { createPostgresRepositories } from "./repositories/postgres.js";
import { DeliveryWorker, DeliveryWorkerLoop } from "./services/delivery-worker.js";

const env = loadEnv();
const { client, db } = createDatabase(env.DATABASE_URL);
const repositories = createPostgresRepositories(db);
const app = await createApp({ env, repositories, logger: true });
const worker = new DeliveryWorker(
  repositories.deliveryWorker,
  repositories.channels,
  env.AUTH_SECRET,
  {
    ...(env.GOOGLE_CLIENT_ID ? { GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID } : {}),
    ...(env.GOOGLE_CLIENT_SECRET ? { GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET } : {}),
    ...(env.GOOGLE_REDIRECT_URI ? { GOOGLE_REDIRECT_URI: env.GOOGLE_REDIRECT_URI } : {}),
  },
  new GoogleProvider(fetch),
  new WahaProvider(fetch),
  env.DELIVERY_WORKER_MAX_ATTEMPTS,
  app.log,
);
const workerLoop = env.DELIVERY_WORKER_ENABLED
  ? new DeliveryWorkerLoop(worker, env.DELIVERY_WORKER_INTERVAL_MS, 10, app.log)
  : null;

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "Shutting down");
  await workerLoop?.stop();
  await app.close();
  await client.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
  workerLoop?.start();
} catch (error) {
  app.log.error(error);
  await client.end();
  process.exit(1);
}
