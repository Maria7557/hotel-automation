import { sealPrivateValue, unsealPrivateValue } from "../lib/public-token.js";
import { GoogleProvider, parseGoogleCredentials } from "../providers/google.js";
import { MicrosoftProvider, parseMicrosoftCredentials } from "../providers/microsoft.js";
import { parseSmtpCredentials, SmtpProvider } from "../providers/smtp.js";
import { ProviderError } from "../providers/http.js";
import { WahaProvider, type WahaConfig } from "../providers/waha.js";
import type {
  ChannelRepository,
  ClaimedOfferDelivery,
  DeliveryWorkerRepository,
} from "../repositories/types.js";
import { renderOfferDelivery } from "./offer-delivery-renderer.js";
import type { NotificationService } from "./notifications.js";

type GoogleConfig = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
};
type WahaPlatformConfig = { baseUrl?: string; apiKey?: string };
type MicrosoftConfig = { MICROSOFT_CLIENT_ID?: string; MICROSOFT_CLIENT_SECRET?: string; MICROSOFT_REDIRECT_URI?: string };

export type DeliveryWorkerLogger = {
  info(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
};

const silentLogger: DeliveryWorkerLogger = { info: () => undefined, error: () => undefined };

export class DeliveryWorker {
  constructor(
    private readonly repository: DeliveryWorkerRepository,
    private readonly channels: ChannelRepository,
    private readonly authSecret: string,
    private readonly googleConfig: GoogleConfig,
    private readonly googleProvider: GoogleProvider,
    private readonly wahaProvider: WahaProvider,
    private readonly maxAttempts = 5,
    private readonly logger: DeliveryWorkerLogger = silentLogger,
    private readonly wahaPlatform: WahaPlatformConfig = {},
    private readonly microsoftConfig: MicrosoftConfig = {},
    private readonly microsoftProvider = new MicrosoftProvider(fetch),
    private readonly smtpProvider = new SmtpProvider(),
    private readonly notifications?: NotificationService,
  ) {}

  async processNext(now = new Date()): Promise<boolean> {
    const job = await this.repository.claimNextOfferDelivery(now);
    if (!job) return false;
    await this.processClaim(job, now);
    return true;
  }

  private async processClaim(job: ClaimedOfferDelivery, now: Date): Promise<void> {
    const delivery = job.delivery;
    const nextAttempt = delivery.attemptCount + 1;
    try {
      if (!job.offer || !job.hotel || job.offer.hotelId !== delivery.hotelId) {
        await this.fail(delivery.id, nextAttempt, now, "DELIVERY_CONTEXT_MISSING");
        return;
      }
      if (job.offer.state !== "active" || job.offer.expiresAt <= now) {
        await this.fail(delivery.id, nextAttempt, now, "OFFER_NOT_ACTIVE");
        return;
      }
      if (!job.connection?.encryptedCredentials || job.connection.state !== "connected") {
        await this.deferWithoutAttempt(delivery.id, delivery.attemptCount, now, `${delivery.channel.toUpperCase()}_CONNECTION_NOT_READY`);
        return;
      }
      if (delivery.channel === "email" && job.connection.kind === "google" && !this.googleIsConfigured()) {
        await this.deferWithoutAttempt(
          delivery.id,
          delivery.attemptCount,
          now,
          "GOOGLE_CONFIG_REQUIRED",
        );
        return;
      }

      const sealedUrl = delivery.payload.proposalUrlCiphertext;
      if (typeof sealedUrl !== "string") {
        await this.fail(delivery.id, nextAttempt, now, "PROPOSAL_URL_MISSING");
        return;
      }
      const proposalUrl = unsealPrivateValue(sealedUrl, this.authSecret);
      const rendered = renderOfferDelivery({
        snapshot: job.offer.snapshot,
        proposalUrl,
        channel: delivery.channel as "email" | "whatsapp",
        settings: job.settings,
        locale: job.hotel.locale,
      });

      if (delivery.channel === "email") {
        if (rendered.channel !== "email") throw new Error("Email render mismatch.");
        const sent = await this.sendEmail(job.connection, { to: delivery.recipient, subject: rendered.subject, html: rendered.html });
        await this.succeed(delivery.id, nextAttempt, now, sent.providerMessageId);
        try {
          await this.channels.updateConnectionForHotel({
            hotelId: delivery.hotelId,
            kind: job.connection.kind,
            state: "connected",
            encryptedCredentials: sealPrivateValue(JSON.stringify(sent.credentials), this.authSecret),
            lastCheckedAt: now,
            lastErrorCode: null,
          });
        } catch {
          this.logger.error(
            { deliveryId: delivery.id, code: "CONNECTION_STATE_UPDATE_FAILED" },
            "Provider accepted delivery but connection state update failed",
          );
        }
      } else {
        if (rendered.channel !== "whatsapp") throw new Error("WhatsApp render mismatch.");
        const sent = await this.wahaProvider.sendText(
          wahaConfig(job.connection, this.authSecret, this.wahaPlatform),
          delivery.recipient,
          rendered.text,
        );
        await this.succeed(delivery.id, nextAttempt, now, sent.providerMessageId);
        try {
          await this.channels.updateConnectionForHotel({
            hotelId: delivery.hotelId,
            kind: "waha",
            state: "connected",
            lastCheckedAt: now,
            lastErrorCode: null,
          });
        } catch {
          this.logger.error(
            { deliveryId: delivery.id, code: "CONNECTION_STATE_UPDATE_FAILED" },
            "Provider accepted delivery but connection state update failed",
          );
        }
      }
      this.logger.info(
        { deliveryId: delivery.id, channel: delivery.channel, state: "provider_accepted" },
        "Offer delivery processed",
      );
    } catch (error) {
      if (error instanceof ProviderError) {
        if (error.ambiguous || error.code.endsWith("_NETWORK_ERROR")) {
          await this.unknown(delivery.id, nextAttempt, now, error.code);
          await this.notifyError(job, error.code);
          this.logOutcome(delivery.id, delivery.channel, "unknown", error.code);
          return;
        }
        if (error.retryable && nextAttempt < this.maxAttempts) {
          await this.retry(delivery.id, nextAttempt, now, error.code);
          this.logOutcome(delivery.id, delivery.channel, "scheduled", error.code);
          return;
        }
        await this.fail(
          delivery.id,
          nextAttempt,
          now,
          error.retryable ? `MAX_ATTEMPTS_${error.code}` : error.code,
        );
        await this.notifyError(job, error.code);
        this.logOutcome(delivery.id, delivery.channel, "failed", error.code);
        return;
      }
      await this.fail(delivery.id, nextAttempt, now, "DELIVERY_RENDER_OR_CREDENTIALS_INVALID");
      await this.notifyError(job, "DELIVERY_RENDER_OR_CREDENTIALS_INVALID");
      this.logOutcome(
        delivery.id,
        delivery.channel,
        "failed",
        "DELIVERY_RENDER_OR_CREDENTIALS_INVALID",
      );
    }
  }

  private async notifyError(job: ClaimedOfferDelivery, code: string): Promise<void> {
    if (!this.notifications || !job.offer) return;
    const guest = job.offer.snapshot.guestSnapshot;
    const guestName = typeof guest === "object" && guest && "name" in guest ? String(guest.name) : "Guest";
    try {
      await this.notifications.notify({
        type: "error",
        hotelId: job.delivery.hotelId,
        inquiryId: job.delivery.inquiryId ?? job.offer.inquiryId,
        guestName,
        message: `Delivery failed (${code}).`,
      });
    } catch {
      // Delivery state is authoritative even when a secondary notification fails.
    }
  }

  private requireGoogleConfig() {
    if (!this.googleIsConfigured()) {
      throw new ProviderError("GOOGLE_CONFIG_REQUIRED", true);
    }
    return {
      clientId: this.googleConfig.GOOGLE_CLIENT_ID!,
      clientSecret: this.googleConfig.GOOGLE_CLIENT_SECRET!,
      redirectUri: this.googleConfig.GOOGLE_REDIRECT_URI!,
    };
  }

  private async sendEmail(connection: NonNullable<ClaimedOfferDelivery["connection"]>, message: { to: string; subject: string; html: string }) {
    const raw = JSON.parse(unsealPrivateValue(connection.encryptedCredentials!, this.authSecret)) as unknown;
    if (connection.kind === "google") return this.googleProvider.send(parseGoogleCredentials(raw), this.requireGoogleConfig(), message);
    if (connection.kind === "microsoft") {
      const { MICROSOFT_CLIENT_ID: clientId, MICROSOFT_CLIENT_SECRET: clientSecret, MICROSOFT_REDIRECT_URI: redirectUri } = this.microsoftConfig;
      if (!clientId || !clientSecret || !redirectUri) throw new ProviderError("MICROSOFT_CONFIG_REQUIRED", true);
      return this.microsoftProvider.send(parseMicrosoftCredentials(raw), { clientId, clientSecret, redirectUri }, message);
    }
    if (connection.kind === "smtp") return { ...(await this.smtpProvider.send(parseSmtpCredentials(raw), message)), credentials: raw };
    throw new ProviderError("MAIL_PROVIDER_INVALID", false);
  }

  private googleIsConfigured(): boolean {
    return Boolean(
      this.googleConfig.GOOGLE_CLIENT_ID &&
        this.googleConfig.GOOGLE_CLIENT_SECRET &&
        this.googleConfig.GOOGLE_REDIRECT_URI,
    );
  }

  private async deferWithoutAttempt(
    deliveryId: string,
    attemptCount: number,
    now: Date,
    code: string,
  ) {
    await this.repository.settleClaimedDelivery({
      deliveryId,
      state: "scheduled",
      attemptCount,
      nextAttemptAt: new Date(now.getTime() + 5 * 60_000),
      providerMessageId: null,
      lastErrorCode: code,
      lastErrorMessage: "Delivery connection is not ready.",
      processedAt: null,
      now,
    });
  }

  private async retry(deliveryId: string, attemptCount: number, now: Date, code: string) {
    await this.repository.settleClaimedDelivery({
      deliveryId,
      state: "scheduled",
      attemptCount,
      nextAttemptAt: new Date(now.getTime() + retryDelayMs(attemptCount)),
      providerMessageId: null,
      lastErrorCode: code,
      lastErrorMessage: "Provider request will be retried.",
      processedAt: null,
      now,
    });
  }

  private async succeed(
    deliveryId: string,
    attemptCount: number,
    now: Date,
    providerMessageId: string | null,
  ) {
    await this.repository.settleClaimedDelivery({
      deliveryId,
      state: "provider_accepted",
      attemptCount,
      nextAttemptAt: now,
      providerMessageId,
      lastErrorCode: null,
      lastErrorMessage: null,
      processedAt: now,
      now,
    });
  }

  private async fail(deliveryId: string, attemptCount: number, now: Date, code: string) {
    await this.repository.settleClaimedDelivery({
      deliveryId,
      state: "failed",
      attemptCount,
      nextAttemptAt: now,
      providerMessageId: null,
      lastErrorCode: code.slice(0, 100),
      lastErrorMessage: "Delivery cannot be completed automatically.",
      processedAt: now,
      now,
    });
  }

  private async unknown(deliveryId: string, attemptCount: number, now: Date, code: string) {
    await this.repository.settleClaimedDelivery({
      deliveryId,
      state: "unknown",
      attemptCount,
      nextAttemptAt: now,
      providerMessageId: null,
      lastErrorCode: code,
      lastErrorMessage: "Provider outcome is unknown; automatic retry is disabled to prevent duplicates.",
      processedAt: now,
      now,
    });
  }

  private logOutcome(deliveryId: string, channel: string, state: string, code: string) {
    this.logger.info({ deliveryId, channel, state, code }, "Offer delivery processed");
  }
}

export class DeliveryWorkerLoop {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private stopped = true;

  constructor(
    private readonly worker: DeliveryWorker,
    private readonly intervalMs: number,
    private readonly batchSize = 10,
    private readonly logger: DeliveryWorkerLogger = silentLogger,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.inFlight;
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.inFlight = this.tick().finally(() => {
        this.inFlight = null;
        this.schedule(this.intervalMs);
      });
    }, delay);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    try {
      for (let count = 0; count < this.batchSize; count += 1) {
        if (!(await this.worker.processNext())) break;
      }
    } catch {
      this.logger.error({ code: "DELIVERY_WORKER_TICK_FAILED" }, "Delivery worker tick failed");
    }
  }
}

export function retryDelayMs(attemptCount: number): number {
  return Math.min(6 * 60 * 60_000, 60_000 * 2 ** Math.max(0, attemptCount - 1));
}

function wahaConfig(
  connection: NonNullable<ClaimedOfferDelivery["connection"]>,
  authSecret: string,
  platform: WahaPlatformConfig = {},
): WahaConfig {
  const { baseUrl, sessionName } = connection.metadata;
  if (
    typeof baseUrl !== "string" ||
    typeof sessionName !== "string"
  ) {
    throw new ProviderError("WAHA_CREDENTIALS_INVALID", false);
  }
  if (platform.baseUrl && platform.apiKey) {
    return { baseUrl: platform.baseUrl, sessionName, apiKey: platform.apiKey };
  }
  if (!connection.encryptedCredentials) {
    throw new ProviderError("WAHA_CREDENTIALS_INVALID", false);
  }
  try {
    const value = JSON.parse(
      unsealPrivateValue(connection.encryptedCredentials, authSecret),
    ) as unknown;
    if (
      typeof value !== "object" ||
      value === null ||
      !("apiKey" in value) ||
      typeof value.apiKey !== "string"
    ) {
      throw new Error("invalid");
    }
    return { baseUrl, sessionName, apiKey: value.apiKey };
  } catch {
    throw new ProviderError("WAHA_CREDENTIALS_INVALID", false);
  }
}
