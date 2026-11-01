import type { AppEnv } from "../config/env.js";
import { errors } from "../lib/errors.js";
import { createOAuthNonce, createOAuthState, hashOAuthNonce, verifyOAuthState } from "../lib/oauth-state.js";
import { sealPrivateValue } from "../lib/public-token.js";
import { GoogleProvider } from "../providers/google.js";
import { MicrosoftProvider } from "../providers/microsoft.js";
import { resolveSafeSmtpHost, SmtpProvider, type SmtpCredentials } from "../providers/smtp.js";
import type { ChannelRepository, HotelRepository } from "../repositories/types.js";
import { detectMailProvider } from "./mail-detection.js";

type Config = Partial<Pick<AppEnv, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GOOGLE_REDIRECT_URI" | "MICROSOFT_CLIENT_ID" | "MICROSOFT_CLIENT_SECRET" | "MICROSOFT_REDIRECT_URI">>;

export class MailConnectionService {
  constructor(private readonly repository: ChannelRepository, private readonly hotels: HotelRepository, private readonly secret: string, private readonly config: Config, private readonly google: GoogleProvider, private readonly microsoft: MicrosoftProvider, private readonly smtp: SmtpProvider) {}
  detect(email: string) { return detectMailProvider(email); }

  async startOAuth(userId: string, provider: "google" | "microsoft", email: string) {
    const cfg = this.oauthConfig(provider); const hotel = await this.hotels.findForUser(userId); if (!hotel) throw errors.hotelNotFound();
    const nonce = createOAuthNonce(); const expiresAt = new Date(Date.now() + 10 * 60_000);
    const pending = await this.repository.beginMailOAuthForUser({ userId, kind: provider, nonceHash: hashOAuthNonce(nonce), expiresAt, metadata: { senderEmail: email.toLowerCase(), provider } });
    if (!pending) throw errors.hotelNotFound();
    const state = createOAuthState(hotel.id, nonce, expiresAt, this.secret);
    const url = provider === "google" ? new URL("https://accounts.google.com/o/oauth2/v2/auth") : new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    url.searchParams.set("client_id", cfg.clientId); url.searchParams.set("redirect_uri", cfg.redirectUri); url.searchParams.set("response_type", "code"); url.searchParams.set("state", state);
    if (provider === "google") { url.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.send"); url.searchParams.set("access_type", "offline"); url.searchParams.set("prompt", "consent"); }
    else { url.searchParams.set("scope", "openid profile email offline_access Mail.Send"); url.searchParams.set("response_mode", "query"); }
    return { authorizationUrl: url.toString(), expiresAt: expiresAt.toISOString() };
  }

  async completeOAuth(provider: "google" | "microsoft", state: string, code: string) {
    const now = new Date(); const verified = verifyOAuthState(state, this.secret, now); if (!verified) throw errors.oauthStateInvalid();
    const connection = await this.repository.consumeMailOAuthState({ hotelId: verified.h, kind: provider, nonceHash: hashOAuthNonce(verified.n), now }); if (!connection) throw errors.oauthStateInvalid();
    const cfg = this.oauthConfig(provider);
    const credentials = provider === "google" ? await this.google.exchangeAuthorizationCode(code, cfg) : await this.microsoft.exchangeAuthorizationCode(code, cfg);
    const senderEmail = String(connection.metadata.senderEmail ?? "");
    const test = { to: senderEmail, subject: "Your hotel mail connection is ready", html: "<p>This test confirms that your hotel can send email.</p>" };
    const sent = provider === "google" ? await this.google.send(credentials as never, cfg, test) : await this.microsoft.send(credentials as never, cfg, test);
    const updated = await this.repository.updateConnectionForHotel({ hotelId: connection.hotelId, kind: provider, state: "connected", encryptedCredentials: sealPrivateValue(JSON.stringify(sent.credentials), this.secret), metadata: { senderEmail, provider, connectedAt: now.toISOString() }, lastCheckedAt: now, lastErrorCode: null });
    return { status: "connected", connection: updated ? publicMail(updated) : null };
  }

  async connectSmtp(userId: string, credentials: SmtpCredentials) {
    await resolveSafeSmtpHost(credentials.hostname);
    const hotel = await this.hotels.findForUser(userId); if (!hotel) throw errors.hotelNotFound();
    await this.smtp.send(credentials, { to: credentials.email, subject: "Your hotel mail connection is ready", html: "<p>This test confirms that your hotel can send email.</p>" });
    const record = await this.repository.configureMailForUser({ userId, kind: "smtp", encryptedCredentials: sealPrivateValue(JSON.stringify(credentials), this.secret), metadata: { senderEmail: credentials.email.toLowerCase(), provider: "smtp", hostname: credentials.hostname, port: credentials.port, encryption: credentials.encryption } });
    if (!record) throw errors.hotelNotFound(); return publicMail(record);
  }

  private oauthConfig(provider: "google" | "microsoft") {
    const clientId = provider === "google" ? this.config.GOOGLE_CLIENT_ID : this.config.MICROSOFT_CLIENT_ID;
    const clientSecret = provider === "google" ? this.config.GOOGLE_CLIENT_SECRET : this.config.MICROSOFT_CLIENT_SECRET;
    const redirectUri = provider === "google" ? this.config.GOOGLE_REDIRECT_URI : this.config.MICROSOFT_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) throw errors.configRequired(provider);
    return { clientId, clientSecret, redirectUri };
  }
}

function publicMail(record: { kind: string; state: string; metadata: Record<string, unknown>; lastCheckedAt: Date | null }) { return { kind: "mail", provider: record.kind, configured: true, available: true, state: record.state, senderEmail: typeof record.metadata.senderEmail === "string" ? record.metadata.senderEmail : null, lastCheckedAt: record.lastCheckedAt?.toISOString() ?? null, lastErrorCode: null }; }
