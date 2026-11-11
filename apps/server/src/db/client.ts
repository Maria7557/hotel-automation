import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });

  const db = drizzle(client, { schema });
  mailFactories.set(db, (onclose) => {
    const mailClient = postgres(databaseUrl, {
      max: 1, idle_timeout: 0, max_lifetime: 0,
      connect_timeout: 10, prepare: false, onclose,
    });
    return { client: mailClient, db: drizzle(mailClient, { schema }) };
  });
  return { client, db };
}

export type Database = ReturnType<typeof createDatabase>["db"];


type MailDatabase = { client: ReturnType<typeof postgres>; db: Database };
const mailFactories = new WeakMap<object, (onclose: () => void) => MailDatabase>();

export function createMailDatabase(db: Database, onclose: () => void): MailDatabase {
  const factory = mailFactories.get(db);
  if (!factory) throw new Error("MAIL_DATABASE_FACTORY_UNAVAILABLE");
  return factory(onclose);
}
