import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "../src/db/client.js";
import { createPostgresRepositories } from "../src/repositories/postgres.js";
import { hashPassword, verifyPassword } from "../src/lib/password.js";
import { createSessionToken, digestSessionToken } from "../src/lib/session-token.js";
import type { AuthRepository } from "../src/repositories/types.js";

const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("PostgreSQL password recovery", () => {
  let core: ReturnType<typeof createDatabase>;
  let repository: AuthRepository;
  const userIds: string[] = [];
  beforeAll(async () => {
    core = createDatabase(databaseUrl!);
    await migrate(core.db, { migrationsFolder: "./drizzle" });
    repository = createPostgresRepositories(core.db).auth;
  }, 20_000);
  afterEach(async () => {
    for (const id of userIds.splice(0)) await core.client`delete from users where id = ${id}`;
  });
  afterAll(async () => { await core?.client.end(); });

  async function setup() {
    const user = await repository.createUser({ email: `reset-${randomUUID()}@example.com`, displayName: "Owner", passwordHash: await hashPassword("original-password") });
    userIds.push(user.id);
    const now = new Date();
    const tokenHash = digestSessionToken(createSessionToken(), "test-secret");
    const input = { userId: user.id, tokenHash, expiresAt: new Date(now.getTime() + 30 * 60_000), requestedAt: now, resendBefore: new Date(now.getTime() - 60_000) };
    const sessionHash = digestSessionToken(createSessionToken(), "test-secret");
    await repository.createSession({ userId: user.id, tokenHash: sessionHash, expiresAt: new Date(now.getTime() + 60_000) });
    return { user, input, sessionHash };
  }

  it("persists only one concurrent email request during the account cooldown", async () => {
    const { user, input } = await setup();
    const issued = await Promise.all(Array.from({ length: 5 }, (_, index) => repository.issuePasswordReset({ ...input, tokenHash: `${input.tokenHash.slice(0, -1)}${index}` })));
    expect(issued.filter(Boolean)).toHaveLength(1);
    const tokens = await core.client`select * from password_reset_tokens where user_id = ${user.id}`;
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.consumed_at).toBeNull();
  });

  it("atomically consumes the link once and revokes sessions in the password transaction", async () => {
    const { user, input, sessionHash } = await setup();
    expect(await repository.issuePasswordReset(input)).toBe(true);
    const firstHash = await hashPassword("first-password");
    const secondHash = await hashPassword("second-password");
    const result = await Promise.all([
      repository.consumePasswordReset({ tokenHash: input.tokenHash, passwordHash: firstHash, now: new Date() }),
      repository.consumePasswordReset({ tokenHash: input.tokenHash, passwordHash: secondHash, now: new Date() }),
    ]);
    expect(result.filter(Boolean)).toHaveLength(1);
    expect(result.find(Boolean)!.id).toBe(user.id);
    const stored = await repository.findUserByEmail(user.email);
    expect(await verifyPassword(result[0] ? "first-password" : "second-password", stored!.passwordHash!)).toBe(true);
    expect(await repository.findUserBySessionHash(sessionHash, new Date())).toBeNull();
    expect(await repository.consumePasswordReset({ tokenHash: input.tokenHash, passwordHash: firstHash, now: new Date() })).toBeNull();
    const [token] = await core.client`select consumed_at from password_reset_tokens where user_id = ${user.id}`;
    expect(token!.consumed_at).not.toBeNull();
  });

  it("rejects superseded and expired tokens without changing the account", async () => {
    const { user, input, sessionHash } = await setup();
    await repository.issuePasswordReset({ ...input, requestedAt: new Date(input.requestedAt.getTime() - 61_000) });
    const replacement = { ...input, tokenHash: "f".repeat(64), expiresAt: new Date(Date.now() - 1) };
    expect(await repository.issuePasswordReset(replacement)).toBe(true);
    const passwordHash = await hashPassword("new-password");
    expect(await repository.consumePasswordReset({ tokenHash: input.tokenHash, passwordHash, now: new Date() })).toBeNull();
    expect(await repository.consumePasswordReset({ tokenHash: replacement.tokenHash, passwordHash, now: new Date() })).toBeNull();
    expect((await repository.findUserByEmail(user.email))!.passwordHash).toBe(user.passwordHash);
    expect(await repository.findUserBySessionHash(sessionHash, new Date())).not.toBeNull();
  });

  it("cannot leave an old-password session alive when login races with a reset", async () => {
    const { user, input } = await setup();
    await repository.issuePasswordReset(input);
    const racingSession = digestSessionToken(createSessionToken(), "test-secret");
    const passwordHash = await hashPassword("changed-password");
    await Promise.all([
      repository.createSession({ userId: user.id, tokenHash: racingSession, expiresAt: input.expiresAt, expectedPasswordHash: user.passwordHash! }),
      repository.consumePasswordReset({ tokenHash: input.tokenHash, passwordHash, now: new Date() }),
    ]);
    expect(await repository.findUserBySessionHash(racingSession, new Date())).toBeNull();
    expect(await repository.createSession({ userId: user.id, tokenHash: racingSession, expiresAt: input.expiresAt, expectedPasswordHash: user.passwordHash! })).toBe(false);
    expect(await repository.createSession({ userId: user.id, tokenHash: racingSession, expiresAt: input.expiresAt, expectedPasswordHash: passwordHash })).toBe(true);
  });
});
