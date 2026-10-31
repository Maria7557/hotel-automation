import "dotenv/config";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import { loadEnv } from "../config/env.js";
import { createDatabase } from "./client.js";

const env = loadEnv();
const { client, db } = createDatabase(env.DATABASE_URL);

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
} finally {
  await client.end();
}
