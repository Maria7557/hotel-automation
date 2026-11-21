import { resolveLanguage, translate, type Language } from "@hotel/i18n";

import { errors } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { createSessionToken, digestSessionToken } from "../lib/session-token.js";
import {
  SocialAuthConfigurationError,
  SocialTokenVerificationError,
  type SocialTokenVerifier,
} from "../providers/social-auth.js";
import type { AuthRepository, PublicUser, SocialProvider } from "../repositories/types.js";
import type { PlatformNotificationMailer } from "./notifications.js";

type PasswordRecovery = {
  mailer: PlatformNotificationMailer;
  appBaseUrl: string;
  onDeliveryError: () => void;
};

type AuthResult = {
  accessToken: string;
  expiresAt: Date;
  user: PublicUser;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function publicUser(user: PublicUser): PublicUser {
  return { id: user.id, email: user.email, displayName: user.displayName, ...(user.uiLanguage ? { uiLanguage: user.uiLanguage } : {}) };
}

export class AuthService {
  private readonly pendingEmails = new Set<Promise<void>>();

  constructor(
    private readonly repository: AuthRepository,
    private readonly secret: string,
    private readonly sessionTtlDays: number,
    private readonly socialTokenVerifier: SocialTokenVerifier,
    private readonly recovery?: PasswordRecovery,
  ) {}

  requestPasswordReset(input: { email: string; language: Language }): void {
    if (!this.recovery?.mailer.configured || this.pendingEmails.size >= 100) {
      throw errors.passwordResetUnavailable();
    }
    // Delivery runs separately so SMTP latency cannot disclose whether an account exists.
    this.queueEmail(() => this.deliverPasswordReset(input));
  }

  async finishPendingEmails(): Promise<void> {
    await Promise.all(this.pendingEmails);
  }

  private queueEmail(deliver: () => Promise<void>): void {
    const pending = deliver().catch(() => {
      // SMTP errors may contain recipient details or reset links; log only a fixed message.
      this.recovery?.onDeliveryError();
    }).finally(() => this.pendingEmails.delete(pending));
    this.pendingEmails.add(pending);
  }

  private resetTokenHash(token: string): string {
    return digestSessionToken(`password-reset:${token}`, this.secret);
  }

  private async deliverPasswordReset(input: { email: string; language: Language }): Promise<void> {
    const recovery = this.recovery!;
    const user = await this.repository.findUserByEmail(normalizeEmail(input.email));
    // Provider-only accounts recover access through their identity provider.
    if (!user?.passwordHash) return;
    const token = createSessionToken();
    const now = new Date();
    const issued = await this.repository.issuePasswordReset({
      userId: user.id, tokenHash: this.resetTokenHash(token),
      requestedAt: now, expiresAt: new Date(now.getTime() + 30 * 60_000),
      resendBefore: new Date(now.getTime() - 60_000),
    });
    if (!issued) return;
    const url = new URL(recovery.appBaseUrl);
    // Fragments are never sent to the web server or included in HTTP referrers.
    url.hash = `reset-password=${token}`;
    const language = resolveLanguage(user.uiLanguage, input.language);
    await recovery.mailer.send({
      to: user.email,
      subject: translate(language, "Reset your password"),
      text: [
        translate(language, "Use this link to choose a new password. It expires in 30 minutes and can only be used once."),
        url.toString(),
        translate(language, "If you did not request this, you can ignore this email. Your password has not changed."),
      ].join("\n\n"),
    });
  }

  async resetPassword(input: { token: string; password: string }): Promise<void> {
    const user = await this.repository.consumePasswordReset({
      tokenHash: this.resetTokenHash(input.token), passwordHash: await hashPassword(input.password), now: new Date(),
    });
    if (!user) throw errors.passwordResetInvalid();
    if (this.recovery?.mailer.configured) {
      this.queueEmail(() => this.recovery!.mailer.send({
        to: user.email,
        subject: translate(resolveLanguage(user.uiLanguage), "Your password has been changed"),
        text: translate(resolveLanguage(user.uiLanguage), "Your password has been changed and all existing sessions have been signed out. If you did not make this change, reset your password immediately and contact support."),
      }));
    }
  }

  async updateLanguage(userId: string, uiLanguage: "en" | "it") {
    await this.repository.updateUserLanguage(userId, uiLanguage);
  }

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

    return this.createSession(publicUser(user), user.passwordHash);
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

  private async createSession(user: PublicUser, expectedPasswordHash?: string): Promise<AuthResult> {
    const accessToken = createSessionToken();
    const expiresAt = new Date(Date.now() + this.sessionTtlDays * 24 * 60 * 60 * 1_000);
    const created = await this.repository.createSession({
      userId: user.id,
      tokenHash: digestSessionToken(accessToken, this.secret),
      expiresAt,
      ...(expectedPasswordHash !== undefined ? { expectedPasswordHash } : {}),
    });
    if (!created) throw errors.invalidCredentials();
    return { accessToken, expiresAt, user };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
