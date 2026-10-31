import { errors } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { createSessionToken, digestSessionToken } from "../lib/session-token.js";
import type { AuthRepository, PublicUser } from "../repositories/types.js";

type AuthResult = {
  accessToken: string;
  expiresAt: Date;
  user: PublicUser;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function publicUser(user: { id: string; email: string; displayName: string | null }): PublicUser {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly secret: string,
    private readonly sessionTtlDays: number,
  ) {}

  async register(input: { email: string; password: string; displayName: string | null }): Promise<AuthResult> {
    const email = normalizeEmail(input.email);
    if (await this.repository.findUserByEmail(email)) throw errors.emailInUse();

    let user;
    try {
      user = await this.repository.createUser({
        email,
        displayName: input.displayName?.trim() || null,
        passwordHash: await hashPassword(input.password),
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw errors.emailInUse();
      throw error;
    }

    return this.createSession(publicUser(user));
  }

  async login(input: { email: string; password: string }): Promise<AuthResult> {
    const user = await this.repository.findUserByEmail(normalizeEmail(input.email));
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw errors.invalidCredentials();
    }

    return this.createSession(publicUser(user));
  }

  async authenticate(accessToken: string): Promise<PublicUser> {
    const user = await this.repository.findUserBySessionHash(
      digestSessionToken(accessToken, this.secret),
      new Date(),
    );
    if (!user) throw errors.unauthorized();
    return user;
  }

  async logout(accessToken: string): Promise<void> {
    await this.repository.deleteSession(digestSessionToken(accessToken, this.secret));
  }

  private async createSession(user: PublicUser): Promise<AuthResult> {
    const accessToken = createSessionToken();
    const expiresAt = new Date(Date.now() + this.sessionTtlDays * 24 * 60 * 60 * 1_000);
    await this.repository.createSession({
      userId: user.id,
      tokenHash: digestSessionToken(accessToken, this.secret),
      expiresAt,
    });
    return { accessToken, expiresAt, user };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
