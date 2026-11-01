import { createRemoteJWKSet, jwtVerify } from "jose";

import type { SocialProvider } from "../repositories/types.js";

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const appleKeys = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

export type VerifiedSocialIdentity = {
  provider: SocialProvider;
  subject: string;
  email: string;
  emailVerified: boolean;
  emailAuthoritative: boolean;
  displayName: string | null;
};

export interface SocialTokenVerifier {
  verify(provider: SocialProvider, idToken: string): Promise<VerifiedSocialIdentity>;
}

export class SocialAuthConfigurationError extends Error {
  constructor(provider: SocialProvider) {
    super(`${provider} social authentication is not configured.`);
    this.name = "SocialAuthConfigurationError";
  }
}

export class SocialTokenVerificationError extends Error {
  constructor(public readonly unavailable = false) {
    super(unavailable ? "Identity provider verification is unavailable." : "Identity token is invalid.");
    this.name = "SocialTokenVerificationError";
  }
}

export class RemoteSocialTokenVerifier implements SocialTokenVerifier {
  constructor(
    private readonly clientIds: { google: string[]; apple: string[] },
  ) {}

  async verify(provider: SocialProvider, idToken: string): Promise<VerifiedSocialIdentity> {
    const audience = this.clientIds[provider];
    if (audience.length === 0) throw new SocialAuthConfigurationError(provider);

    try {
      const { payload } = await jwtVerify(idToken, provider === "google" ? googleKeys : appleKeys, {
        algorithms: ["RS256"],
        issuer: provider === "google"
          ? ["accounts.google.com", "https://accounts.google.com"]
          : "https://appleid.apple.com",
        audience,
      });

      if (Array.isArray(payload.aud)) {
        if (typeof payload.azp !== "string" || !audience.includes(payload.azp)) {
          throw new SocialTokenVerificationError();
        }
      }

      const emailVerified = payload.email_verified === true || payload.email_verified === "true";
      if (
        typeof payload.sub !== "string" ||
        payload.sub.length === 0 ||
        typeof payload.email !== "string" ||
        payload.email.length === 0
      ) {
        throw new SocialTokenVerificationError();
      }

      return {
        provider,
        subject: payload.sub,
        email: payload.email,
        emailVerified,
        emailAuthoritative: provider === "apple" ||
          payload.email.toLowerCase().endsWith("@gmail.com") ||
          (emailVerified && typeof payload.hd === "string" && payload.hd.length > 0),
        displayName: provider === "google" && typeof payload.name === "string" ? payload.name : null,
      };
    } catch (error) {
      if (error instanceof SocialTokenVerificationError) throw error;
      const code = typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
      if (error instanceof TypeError || code === "ERR_JWKS_TIMEOUT") {
        throw new SocialTokenVerificationError(true);
      }
      throw new SocialTokenVerificationError();
    }
  }
}

export function socialClientIds(value: string | undefined): string[] {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}
