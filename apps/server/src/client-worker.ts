import "dotenv/config";
import { loadEnv } from "./config/env.js";
import { createClientConnection, PostgresClientRepository } from "./repositories/clients.js";
import { ClientWorker, ClientWorkerLoop, type ClientWorkerLogger } from "./services/client-worker.js";

const env = loadEnv();
const connection = createClientConnection(env.DATABASE_URL, 1);
const logger: ClientWorkerLogger = {
  info: (fields, message) => console.info(JSON.stringify({ ...fields, message })),
  error: (fields, message) => console.error(JSON.stringify({ ...fields, message })),
};
const loop = new ClientWorkerLoop(new ClientWorker(new PostgresClientRepository(connection), logger, env.CLIENT_WORKER_BATCH_SIZE), env.CLIENT_WORKER_INTERVAL_MS, logger);
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await loop.stop();
  await connection.end({ timeout: 3 });
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
loop.start();
