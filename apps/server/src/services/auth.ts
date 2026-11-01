import { errors } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { createSessionToken, digestSessionToken } from "../lib/session-token.js";
import {
  SocialAuthConfigurationError,
  SocialTokenVerificationError,
  type SocialTokenVerifier,
} from "../providers/social-auth.js";
import type { AuthRepository, PublicUser, SocialProvider } from "../repositories/types.js";

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
    private readonly socialTokenVerifier: SocialTokenVerifier,
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
    if (!user || !user.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
      throw errors.invalidCredentials();
    }

    return this.createSession(publicUser(user));
  }

  async socialLogin(input: { provider: SocialProvider; idToken: string }): Promise<AuthResult> {
    let identity;
    try {
      identity = await this.socialTokenVerifier.verify(input.provider, input.idToken);
    } catch (error) {
      if (error instanceof SocialAuthConfigurationError) throw errors.configRequired(input.provider);
      if (error instanceof SocialTokenVerificationError) {
        if (error.unavailable) throw errors.socialProviderUnavailable(input.provider);
        throw errors.socialTokenInvalid();
      }
      throw error;
    }

    if (identity.provider !== input.provider || !identity.emailVerified) {
      throw errors.socialEmailUnverified();
    }

    const socialUser = {
      provider: input.provider,
      subject: identity.subject,
      email: normalizeEmail(identity.email),
      displayName: identity.displayName?.trim().slice(0, 120) || null,
      allowEmailLink: identity.emailAuthoritative,
    };

    let user;
    try {
      user = await this.repository.findOrCreateSocialUser(socialUser);
    } catch (error) {
      if (error instanceof Error && error.name === "SocialIdentityConflictError") {
        throw errors.socialAccountConflict();
      }
      if (!isUniqueViolation(error)) throw error;
      try {
        user = await this.repository.findOrCreateSocialUser(socialUser);
      } catch (retryError) {
        if (
          isUniqueViolation(retryError) ||
          (retryError instanceof Error && retryError.name === "SocialIdentityConflictError")
        ) {
          throw errors.socialAccountConflict();
        }
        throw retryError;
      }
    }

    return this.createSession(publicUser(user));
  }

  async authenticate(accessToken: string): Promise<PublicUser> {
    const now = new Date();
    const tokenHash = digestSessionToken(accessToken, this.secret);
    const user = await this.repository.findUserBySessionHash(
      tokenHash,
      now,
    );
    if (!user) throw errors.unauthorized();
    const dayMs = 24 * 60 * 60 * 1_000;
    await this.repository.refreshSessionExpiry({
      tokenHash,
      now,
      renewBefore: new Date(now.getTime() + Math.max(0, this.sessionTtlDays - 1) * dayMs),
      expiresAt: new Date(now.getTime() + this.sessionTtlDays * dayMs),
    });
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
