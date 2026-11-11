import { DEFAULT_GUEST_LANGUAGE } from "@hotel/contracts";
import { randomUUID } from "node:crypto";

import type { AppEnv } from "../config/env.js";
import type { z } from "zod";
import {
  allowedMessageVariables,
  type previewInputSchema,
  type testSendInputSchema,
} from "../http/channel-schemas.js";
import { AppError, errors } from "../lib/errors.js";
import {
  createOAuthNonce,
  createOAuthState,
  hashOAuthNonce,
  verifyOAuthState,
} from "../lib/oauth-state.js";
import { sealPrivateValue } from "../lib/public-token.js";
import { unsealPrivateValue } from "../lib/public-token.js";
import { GoogleProvider } from "../providers/google.js";
import { MicrosoftProvider } from "../providers/microsoft.js";
import { SmtpProvider } from "../providers/smtp.js";
import { isMailConnection, selectMailConnection } from "../repositories/mail-selection.js";
import { MailSender, type MailConfig } from "./mail-sender.js";
import { ProviderError } from "../providers/http.js";
import { WahaProvider, type WahaConfig } from "../providers/waha.js";
import type {
  ChannelRepository,
  ConnectionRecord,
  HotelProfile,
  HotelRepository,
  MessageSettingsUpdate,
} from "../repositories/types.js";
import type { AutomationService } from "./automation.js";
import { renderOfferDelivery } from "./offer-delivery-renderer.js";

export const defaultMessageSettings: MessageSettingsUpdate = {
  emailSubjectTemplate: "La sua offerta da {{hotel_name}}",
  emailBodyTemplate:
    "Gentile {{guest_name}},\n\nLa sua offerta dal {{check_in}} al {{check_out}} è pronta.\nTotale: {{total}}\n\n{{offer_url}}",
  whatsappBodyTemplate:
    "Gentile {{guest_name}}, la sua offerta da {{hotel_name}} è pronta: {{offer_url}}",
};

type PreviewInput = z.infer<typeof previewInputSchema>;
type TestSendInput = z.infer<typeof testSendInputSchema>;
type OAuthConfig = Pick<AppEnv, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GOOGLE_REDIRECT_URI">;
type WahaPlatformConfig = { baseUrl?: string; apiKey?: string };

export class ChannelService {
  constructor(
    private readonly repository: ChannelRepository,
    private readonly hotels: HotelRepository,
    private readonly authSecret: string,
    private readonly automation: AutomationService,
    private readonly google: Partial<OAuthConfig>,
    private readonly googleProvider: GoogleProvider,
    private readonly wahaProvider: WahaProvider,
    private readonly waha: WahaPlatformConfig = {},
    private readonly microsoft: MailConfig = {},
    private readonly microsoftProvider = new MicrosoftProvider(fetch),
    private readonly smtpProvider = new SmtpProvider(),
  ) {}

  async getMessageSettings(userId: string) {
    const hotel = await this.requireHotel(userId);
    const current = await this.repository.findMessageSettingsForUser(userId);
    return {
      ...(current ?? { hotelId: hotel.id, ...defaultMessageSettings }),
      allowedVariables: [...allowedMessageVariables],
    };
  }

  async updateMessageSettings(userId: string, input: MessageSettingsUpdate) {
    await this.requireHotel(userId);
    const settings = await this.repository.upsertMessageSettingsForUser(userId, input);
    if (!settings) throw errors.hotelNotFound();
    return { ...settings, allowedVariables: [...allowedMessageVariables] };
  }

  async preview(userId: string, input: PreviewInput) {
    const hotel = await this.requireHotel(userId);
    const settings = await this.effectiveSettings(userId);
    const testOffer = await this.automation.createTestProposal(userId, input.sample);
    return this.renderTestPreview(hotel, settings, input, testOffer);
  }

  async testSend(userId: string, input: TestSendInput) {
    const hotel = await this.requireHotel(userId);
    const settings = await this.effectiveSettings(userId);
    const testOffer = await this.automation.createTestProposal(userId, input.sample);
    const rendered = this.renderTestPreview(hotel, settings, input, testOffer);
    const mail = input.channel === "email"
      ? selectMailConnection((await this.repository.listConnectionsForUser(userId)) ?? [])
      : null;
    const connection = input.channel === "email"
      ? mail!.connection
      : await this.repository.findConnectionForUser(userId, "waha");
    if (connection?.state !== "connected" || !connection.encryptedCredentials) {
      return this.saveTestResult(userId, input, rendered, {
        provider: "fake",
        accepted: false,
        state: "unknown",
        providerMessageId: null,
        lastErrorCode: mail?.ambiguous ? "MAIL_CONNECTION_AMBIGUOUS" : "FAKE_PROVIDER",
        lastErrorMessage: "No external provider call was made.",
      });
    }

    const connectionKind = connection.kind;
    try {
      if (input.channel === "email") {
        if (!("subject" in rendered) || typeof rendered.html !== "string") {
          throw new ProviderError("GMAIL_MESSAGE_INVALID", false);
        }
        const sender = new MailSender(this.repository, this.authSecret, { ...this.google, ...this.microsoft }, this.googleProvider, this.microsoftProvider, this.smtpProvider);
        const sent = await sender.send(connection, {
          to: input.recipient,
          subject: rendered.subject,
          html: rendered.html,
        });
        return this.saveTestResult(userId, input, rendered, {
          provider: connectionKind === "google" ? "gmail" : connectionKind,
          accepted: true,
          state: "provider_accepted",
          providerMessageId: sent.providerMessageId,
          lastErrorCode: null,
          lastErrorMessage: null,
        });
      }

      const wahaConfig = this.wahaConfig(connection);
      const session = await this.wahaProvider.sessionStatus(wahaConfig);
      if (session.phoneNumber && samePhoneNumber(session.phoneNumber, input.recipient)) {
        await this.repository.updateConnectionForHotel({
          hotelId: hotel.id,
          kind: "waha",
          state: "connected",
          metadata: { ...connection.metadata, sessionStatus: session.status, phoneNumber: session.phoneNumber },
          lastCheckedAt: new Date(),
          lastErrorCode: null,
        });
        return this.saveTestResult(userId, input, rendered, {
          provider: "waha",
          accepted: false,
          state: "failed",
          providerMessageId: null,
          lastErrorCode: "WAHA_RECIPIENT_IS_SENDER",
          lastErrorMessage: "The test recipient is the same number as the connected WhatsApp sender.",
        });
      }
      const sent = await this.wahaProvider.sendText(wahaConfig, input.recipient, rendered.text);
      await this.repository.updateConnectionForHotel({
        hotelId: hotel.id,
        kind: "waha",
        state: "connected",
        lastCheckedAt: new Date(),
        lastErrorCode: null,
      });
      return this.saveTestResult(userId, input, rendered, {
        provider: "waha",
        accepted: true,
        state: "provider_accepted",
        providerMessageId: sent.providerMessageId,
        lastErrorCode: null,
        lastErrorMessage: null,
      });
    } catch (error) {
      const failure = providerFailure(error, connectionKind.toUpperCase());
      await this.repository.updateConnectionForHotel({
        hotelId: hotel.id,
        kind: connectionKind,
        state: "attention",
        expectedEncryptedCredentials: connection.encryptedCredentials,
        lastCheckedAt: new Date(),
        lastErrorCode: failure.code,
      });
      return this.saveTestResult(userId, input, rendered, {
        provider: connectionKind === "google" ? "gmail" : connectionKind,
        accepted: false,
        state: failure.retryable ? "unknown" : "failed",
        providerMessageId: null,
        lastErrorCode: failure.code,
        lastErrorMessage: "External provider request failed.",
      });
    }
  }

  async connectionStatuses(userId: string) {
    await this.requireHotel(userId);
    const records = await this.repository.listConnectionsForUser(userId);
    if (!records) throw errors.hotelNotFound();
    const selected = selectMailConnection(records);
    const mail = selected.connection ?? records.find(isMailConnection) ?? null;
    const storedWaha = records.find((record) => record.kind === "waha") ?? null;
    const waha = storedWaha?.encryptedCredentials
      ? await this.checkWaha(userId)
      : this.publicConnection("waha", storedWaha);
    const mailStatus = selected.ambiguous
      ? { ...this.publicMailConnection(null), available: true, state: "attention", lastErrorCode: "MAIL_CONNECTION_AMBIGUOUS" }
      : this.publicMailConnection(mail);
    return [mailStatus, waha];
  }

  async wahaStatus(userId: string) {
    await this.requireHotel(userId);
    return this.publicConnection("waha", await this.repository.findConnectionForUser(userId, "waha"));
  }

  async connectWaha(userId: string) {
    const hotel = await this.requireHotel(userId);
    const platform = this.requireWahaPlatformConfig();
    const sessionName = `hotel-${hotel.id.replace(/[^A-Za-z0-9_-]/g, "")}`.slice(0, 80);
    const config: WahaConfig = { ...platform, sessionName };
    let prepared = await this.wahaProvider.prepareSession(config);
    if (!prepared.working && prepared.status === "STARTING") {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await wait(500);
        prepared = await this.wahaProvider.sessionStatus(config);
        if (prepared.working || prepared.status !== "STARTING") break;
      }
    }
    const encryptedCredentials = sealPrivateValue(
      JSON.stringify({ apiKey: platform.apiKey }),
      this.authSecret,
    );
    const configured = await this.repository.configureWahaForUser({
      userId,
      encryptedCredentials,
      metadata: {
        baseUrl: platform.baseUrl,
        sessionName,
        sessionStatus: prepared.status,
        phoneNumber: prepared.phoneNumber,
        configuredAt: new Date().toISOString(),
      },
    });
    if (!configured) throw errors.hotelNotFound();

    const now = new Date();
    const updated = await this.repository.updateConnectionForHotel({
      hotelId: hotel.id,
      kind: "waha",
      state: prepared.working ? "connected" : "connecting",
      encryptedCredentials,
      metadata: configured.metadata,
      lastCheckedAt: now,
      lastErrorCode: null,
    });
    if (!updated) throw errors.hotelNotFound();

    let qrCode: string | null = null;
    if (!prepared.working && prepared.status !== "STARTING") {
      qrCode = await this.wahaProvider.qrCode(config);
    }
    return { connection: this.publicConnection("waha", updated), qrCode };
  }

  async checkWaha(userId: string) {
    const hotel = await this.requireHotel(userId);
    const current = await this.repository.findConnectionForUser(userId, "waha");
    if (!current?.encryptedCredentials) throw errors.configRequired("waha");
    const now = new Date();
    try {
      const status = await this.wahaProvider.sessionStatus(this.wahaConfig(current));
      const connecting = ["STARTING", "SCAN_QR_CODE"].includes(status.status);
      const updated = await this.repository.updateConnectionForHotel({
        hotelId: hotel.id,
        kind: "waha",
        state: status.working ? "connected" : connecting ? "connecting" : "attention",
        metadata: { ...current.metadata, sessionStatus: status.status, phoneNumber: status.phoneNumber },
        lastCheckedAt: now,
        lastErrorCode: status.working || connecting ? null : `WAHA_SESSION_${status.status}`,
      });
      return this.publicConnection("waha", updated);
    } catch (error) {
      const failure = providerFailure(error, "WAHA_STATUS");
      const updated = await this.repository.updateConnectionForHotel({
        hotelId: hotel.id,
        kind: "waha",
        state: "attention",
        lastCheckedAt: now,
        lastErrorCode: failure.code,
      });
      return this.publicConnection("waha", updated);
    }
  }

  async disconnectWaha(userId: string) {
    const hotel = await this.requireHotel(userId);
    const current = await this.repository.findConnectionForUser(userId, "waha");
    if (!current?.encryptedCredentials) {
      return this.publicConnection("waha", current);
    }
    try {
      await this.wahaProvider.logoutSession(this.wahaConfig(current));
    } catch {
      throw errors.providerConnectionFailed("WhatsApp");
    }
    const now = new Date();
    const updated = await this.repository.updateConnectionForHotel({
      hotelId: hotel.id,
      kind: "waha",
      state: "disconnected",
      encryptedCredentials: null,
      metadata: {
        ...current.metadata,
        sessionStatus: "DISCONNECTED",
        disconnectedAt: now.toISOString(),
      },
      lastCheckedAt: now,
      lastErrorCode: null,
    });
    return this.publicConnection("waha", updated);
  }

  async startGoogleOAuth(userId: string) {
    const config = this.requireGoogleConfig();
    await this.requireHotel(userId);
    const nonce = createOAuthNonce();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1_000);
    const pending = await this.repository.beginGoogleOAuthForUser({
      userId,
      nonceHash: hashOAuthNonce(nonce),
      expiresAt,
    });
    if (!pending) throw errors.hotelNotFound();
    const state = createOAuthState(pending.hotelId, nonce, expiresAt, this.authSecret);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.send");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    return { authorizationUrl: url.toString(), expiresAt: expiresAt.toISOString() };
  }

  async completeGoogleOAuth(state: string, authorizationCode: string) {
    const config = this.requireGoogleConfig();
    const now = new Date();
    const verified = verifyOAuthState(state, this.authSecret, now);
    if (!verified) throw errors.oauthStateInvalid();
    const connection = await this.repository.consumeGoogleOAuthState({
      hotelId: verified.h,
      nonceHash: hashOAuthNonce(verified.n),
      now,
    });
    if (!connection) throw errors.oauthStateInvalid();
    try {
      const credentials = await this.googleProvider.exchangeAuthorizationCode(authorizationCode, config);
      const completed = await this.repository.activateMailConnectionForHotel({
        hotelId: connection.hotelId,
        kind: "google",
        expectedOAuthAttemptId: hashOAuthNonce(verified.n),
        encryptedCredentials: sealPrivateValue(JSON.stringify(credentials), this.authSecret),
        metadata: {
          ...connection.metadata,
          oauthNonceHash: undefined,
          oauthExpiresAt: undefined,
          authorizationReceivedAt: undefined,
          connectedAt: now.toISOString(),
          scope: credentials.scope,
        },
        lastCheckedAt: now,
        lastErrorCode: null,
      });
      if (!completed) throw errors.oauthStateInvalid();
      return { status: "connected" as const, connection: this.publicConnection("google", completed) };
    } catch (error) {
      if (error instanceof AppError && error.code === "OAUTH_STATE_INVALID") throw error;
      const failure = providerFailure(error, "GOOGLE_TOKEN");
      await this.repository.updateConnectionForHotel({
        hotelId: connection.hotelId,
        kind: "google",
        state: "attention",
        expectedOAuthAttemptId: hashOAuthNonce(verified.n),
        metadata: { authorizationFailedAt: now.toISOString() },
        lastCheckedAt: now,
        lastErrorCode: failure.code,
      });
      throw errors.providerConnectionFailed("google");
    }
  }

  private async effectiveSettings(userId: string): Promise<MessageSettingsUpdate> {
    return (await this.repository.findMessageSettingsForUser(userId)) ?? defaultMessageSettings;
  }

  private renderTestPreview(
    hotel: HotelProfile,
    settings: MessageSettingsUpdate,
    input: PreviewInput,
    testOffer: Awaited<ReturnType<AutomationService["createTestProposal"]>>,
  ) {
    const rendered = renderOfferDelivery({
      snapshot: { ...testOffer.snapshot, guestSnapshot: { ...(testOffer.snapshot.guestSnapshot as Record<string, unknown>), language: input.sample?.language ?? DEFAULT_GUEST_LANGUAGE } },
      proposalUrl: `${testOffer.proposalUrl}${input.sample?.language ? `?lang=${input.sample.language}` : ""}`,
      channel: input.channel,
      settings: { hotelId: hotel.id, ...settings, createdAt: new Date(), updatedAt: new Date() },
    });
    const guest = record(testOffer.snapshot.guestSnapshot);
    const options = Array.isArray(testOffer.snapshot.options) ? testOffer.snapshot.options : [];
    return {
      ...rendered,
      offer: {
        url: `${testOffer.proposalUrl}${input.sample?.language ? `?lang=${input.sample.language}` : ""}`,
        hotelName: hotel.name,
        checkIn: typeof guest?.checkIn === "string" ? guest.checkIn : "",
        checkOut: typeof guest?.checkOut === "string" ? guest.checkOut : "",
        roomNames: options.flatMap((option) => {
          const value = record(option)?.roomName;
          return typeof value === "string" ? [value] : [];
        }),
      },
    };
  }

  private publicConnection(kind: "google" | "waha", connection: ConnectionRecord | null) {
    const metadata = connection?.metadata ?? {};
    return {
      kind,
      configured: connection?.encryptedCredentials !== null && connection?.encryptedCredentials !== undefined,
      available: kind === "waha"
        ? Boolean(connection?.encryptedCredentials) || this.wahaConfigured()
        : this.googleConfigured(),
      state: connection?.state ?? "disconnected",
      lastCheckedAt: connection?.lastCheckedAt?.toISOString() ?? null,
      lastErrorCode: connection?.lastErrorCode ?? null,
      ...(kind === "waha"
        ? {
            baseUrl: typeof metadata.baseUrl === "string" ? metadata.baseUrl : null,
            sessionName: typeof metadata.sessionName === "string" ? metadata.sessionName : null,
            phoneNumber: typeof metadata.phoneNumber === "string" ? metadata.phoneNumber : null,
          }
        : {}),
    };
  }

  private publicMailConnection(connection: ConnectionRecord | null) {
    return {
      kind: "mail" as const,
      provider: connection?.kind ?? null,
      configured: Boolean(connection?.encryptedCredentials),
      available: this.googleConfigured() || Boolean(connection),
      state: connection?.state ?? "disconnected",
      senderEmail: typeof connection?.metadata.senderEmail === "string" ? connection.metadata.senderEmail : null,
      lastCheckedAt: connection?.lastCheckedAt?.toISOString() ?? null,
      lastErrorCode: connection?.lastErrorCode ?? null,
    };
  }

  private publicDelivery(delivery: {
    id: string;
    channel: string;
    state: string;
    recipient: string;
    lastErrorCode: string | null;
    createdAt: Date;
  }) {
    return {
      id: delivery.id,
      channel: delivery.channel,
      state: delivery.state,
      recipient: delivery.recipient,
      lastErrorCode: delivery.lastErrorCode,
      createdAt: delivery.createdAt.toISOString(),
    };
  }

  private async saveTestResult(
    userId: string,
    input: TestSendInput,
    rendered: ReturnType<ChannelService["renderTestPreview"]>,
    result: {
      provider: "fake" | "gmail" | "microsoft" | "smtp" | "waha";
      accepted: boolean;
      state: "provider_accepted" | "failed" | "unknown";
      providerMessageId: string | null;
      lastErrorCode: string | null;
      lastErrorMessage: string | null;
    },
  ) {
    const now = new Date();
    const delivery = await this.repository.createTestDeliveryForUser(userId, {
      id: randomUUID(),
      inquiryId: null,
      offerVersionId: null,
      kind: "test",
      channel: input.channel,
      state: result.state,
      idempotencyKey: `test:${randomUUID()}`,
      recipient: input.recipient,
      payload: { schemaVersion: 1, rendered },
      attemptCount: 1,
      nextAttemptAt: now,
      providerMessageId: result.providerMessageId,
      lastErrorCode: result.lastErrorCode,
      lastErrorMessage: result.lastErrorMessage,
      processedAt: now,
    });
    if (!delivery) throw errors.hotelNotFound();
    return {
      provider: result.provider,
      accepted: result.accepted,
      delivery: this.publicDelivery(delivery),
      rendered,
    };
  }

  private wahaConfig(connection: ConnectionRecord): WahaConfig {
    const metadata = connection.metadata;
    if (
      !connection.encryptedCredentials ||
      typeof metadata.baseUrl !== "string" ||
      typeof metadata.sessionName !== "string"
    ) {
      throw new ProviderError("WAHA_CREDENTIALS_INVALID", false);
    }
    try {
      const credentials = JSON.parse(
        unsealPrivateValue(connection.encryptedCredentials, this.authSecret),
      ) as unknown;
      if (
        typeof credentials !== "object" ||
        credentials === null ||
        !("apiKey" in credentials) ||
        typeof credentials.apiKey !== "string"
      ) {
        throw new Error("invalid credentials");
      }
      return { baseUrl: metadata.baseUrl, sessionName: metadata.sessionName, apiKey: credentials.apiKey };
    } catch {
      throw new ProviderError("WAHA_CREDENTIALS_INVALID", false);
    }
  }

  private async requireHotel(userId: string): Promise<HotelProfile> {
    const hotel = await this.hotels.findForUser(userId);
    if (!hotel) throw errors.hotelNotFound();
    return hotel;
  }

  private googleConfigured(): boolean {
    return Boolean(
      this.google.GOOGLE_CLIENT_ID &&
        this.google.GOOGLE_CLIENT_SECRET &&
        this.google.GOOGLE_REDIRECT_URI,
    );
  }

  private requireGoogleConfig() {
    if (!this.googleConfigured()) throw errors.configRequired("google");
    return {
      clientId: this.google.GOOGLE_CLIENT_ID!,
      clientSecret: this.google.GOOGLE_CLIENT_SECRET!,
      redirectUri: this.google.GOOGLE_REDIRECT_URI!,
    };
  }

  private wahaConfigured(): boolean {
    return Boolean(this.waha.baseUrl && this.waha.apiKey);
  }

  private requireWahaPlatformConfig(): { baseUrl: string; apiKey: string } {
    if (!this.wahaConfigured()) throw errors.configRequired("waha");
    return { baseUrl: this.waha.baseUrl!, apiKey: this.waha.apiKey! };
  }
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function samePhoneNumber(left: string, right: string): boolean {
  const digits = (value: string) => value.replace(/\D/g, "");
  return digits(left).length > 0 && digits(left) === digits(right);
}

function providerFailure(error: unknown, fallback: string): ProviderError {
  return error instanceof ProviderError ? error : new ProviderError(`${fallback}_FAILED`, false);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
