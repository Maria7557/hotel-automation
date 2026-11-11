import type { AppEnv } from "../config/env.js";
import { sealPrivateValue, unsealPrivateValue } from "../lib/public-token.js";
import { GoogleProvider, parseGoogleCredentials, type GmailMessage } from "../providers/google.js";
import { ProviderError } from "../providers/http.js";
import { MicrosoftProvider, parseMicrosoftCredentials } from "../providers/microsoft.js";
import { parseSmtpCredentials, SmtpProvider } from "../providers/smtp.js";
import { MailConnectionLostError, MailConnectionBusyError, selectMailConnection } from "../repositories/mail-selection.js";
import type { ChannelRepository, ConnectionRecord } from "../repositories/types.js";

export type MailConfig = Partial<Pick<AppEnv,
  "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GOOGLE_REDIRECT_URI" |
  "MICROSOFT_CLIENT_ID" | "MICROSOFT_CLIENT_SECRET" | "MICROSOFT_REDIRECT_URI"
>>;

// Test sends and queued offers must use the same credential and provider dispatch.
export class MailSender {
  constructor(
    private readonly repository: ChannelRepository,
    private readonly secret: string,
    private readonly config: MailConfig,
    private readonly google: GoogleProvider,
    private readonly microsoft: MicrosoftProvider,
    private readonly smtp: SmtpProvider,
  ) {}

  assertConfigured(kind: ConnectionRecord["kind"]) {
    if (kind === "google" || kind === "microsoft") this.oauthConfig(kind);
    else if (kind !== "smtp") throw new ProviderError("MAIL_PROVIDER_INVALID", false);
  }

  async send(snapshot: ConnectionRecord, message: GmailMessage) {
    return this.repository.withMailConnectionLock(snapshot.hotelId, async (repository) => {
      const signal = repository.mailConnectionSignal();
      signal?.throwIfAborted();
      const selected = selectMailConnection(await repository.listConnectionsForHotel(snapshot.hotelId));
      const connection = selected.connection;
      const generation = (record: ConnectionRecord) => record.metadata.mailGeneration ?? record.id;
      if (!connection || connection.id !== snapshot.id || generation(connection) !== generation(snapshot) ||
        connection.state !== "connected" || !connection.encryptedCredentials) {
        throw new ProviderError("EMAIL_CONNECTION_NOT_READY", true);
      }
      this.assertConfigured(connection.kind);
      let encryptedCredentials = connection.encryptedCredentials;
      const raw = JSON.parse(unsealPrivateValue(encryptedCredentials, this.secret)) as unknown;
      const persistRefresh = async (credentials: unknown) => {
        const next = sealPrivateValue(JSON.stringify(credentials), this.secret);
        const updated = await repository.updateConnectionForHotel({
          hotelId: connection.hotelId, kind: connection.kind, state: "connected",
          expectedEncryptedCredentials: encryptedCredentials, encryptedCredentials: next,
          lastCheckedAt: new Date(), lastErrorCode: null,
        });
        if (!updated) throw new ProviderError("EMAIL_CONNECTION_NOT_READY", true);
        encryptedCredentials = next;
      };
      const sent = connection.kind === "google"
        ? await this.google.send(parseGoogleCredentials(raw), this.oauthConfig("google"), message, persistRefresh, signal)
        : connection.kind === "microsoft"
          ? await this.microsoft.send(parseMicrosoftCredentials(raw), this.oauthConfig("microsoft"), message, persistRefresh, signal)
          : await this.smtp.send(parseSmtpCredentials(raw), message, signal);
      // The provider has already accepted. A secondary status-write failure must
      // never turn that success into a retry and duplicate the guest's message.
      let connectionUpdateFailed = false;
      try {
        await repository.updateConnectionForHotel({
          hotelId: connection.hotelId, kind: connection.kind, state: "connected",
          expectedEncryptedCredentials: encryptedCredentials,
          lastCheckedAt: new Date(), lastErrorCode: null,
        });
      } catch { connectionUpdateFailed = true; }
      return { providerMessageId: sent.providerMessageId, connectionUpdateFailed };
    }).catch((error: unknown) => {
      if (error instanceof MailConnectionLostError) throw new ProviderError("EMAIL_CONNECTION_INTERRUPTED", false, true);
      if (error instanceof MailConnectionBusyError) throw new ProviderError("EMAIL_CONNECTION_NOT_READY", true);
      throw error;
    });
  }

  private oauthConfig(kind: "google" | "microsoft") {
    const clientId = kind === "google" ? this.config.GOOGLE_CLIENT_ID : this.config.MICROSOFT_CLIENT_ID;
    const clientSecret = kind === "google" ? this.config.GOOGLE_CLIENT_SECRET : this.config.MICROSOFT_CLIENT_SECRET;
    const redirectUri = kind === "google" ? this.config.GOOGLE_REDIRECT_URI : this.config.MICROSOFT_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) throw new ProviderError(`${kind.toUpperCase()}_CONFIG_REQUIRED`, true);
    return { clientId, clientSecret, redirectUri };
  }
}
