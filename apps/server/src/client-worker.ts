import { createWorkerMonitor, monitoredLogger } from "./monitoring/index.js";
import "dotenv/config";
import { safeLogFields, safeError } from "./safe-logging.js";
import { loadEnv } from "./config/env.js";
import { createClientConnection, PostgresClientRepository } from "./repositories/clients.js";
import { ClientWorker, ClientWorkerLoop, type ClientWorkerLogger } from "./services/client-worker.js";

const env = loadEnv();
const connection = createClientConnection(env.DATABASE_URL, 1);
const monitor = createWorkerMonitor(env);
const logRecord = (fields: Record<string, unknown>) => {
  const safe = safeLogFields(fields);
  return safe.err ? { err: safeError(safe.err) } : {};
};
const logger: ClientWorkerLogger = monitoredLogger({
  info: (fields) => console.info(JSON.stringify({ ...logRecord(fields), message: "Worker event" })),
  error: (fields) => console.error(JSON.stringify({ ...logRecord(fields), message: "Worker error" })),
}, monitor, "clientWorker");
const loop = new ClientWorkerLoop(new ClientWorker(new PostgresClientRepository(connection), logger, env.CLIENT_WORKER_BATCH_SIZE, monitor), env.CLIENT_WORKER_INTERVAL_MS, logger);
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await loop.stop();
  await monitor?.stop();
  await connection.end({ timeout: 3 });
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
loop.start();
