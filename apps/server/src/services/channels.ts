import { randomUUID } from "node:crypto";

import { escapeHtml, safeHeaderText } from "@hotel/templates";

import type { AppEnv } from "../config/env.js";
import type { z } from "zod";
import {
  allowedMessageVariables,
  type previewInputSchema,
  type testSendInputSchema,
} from "../http/channel-schemas.js";
import { errors } from "../lib/errors.js";
import {
  createOAuthNonce,
  createOAuthState,
  hashOAuthNonce,
  verifyOAuthState,
} from "../lib/oauth-state.js";
import { sealPrivateValue } from "../lib/public-token.js";
import { unsealPrivateValue } from "../lib/public-token.js";
import { GoogleProvider, parseGoogleCredentials } from "../providers/google.js";
import { ProviderError } from "../providers/http.js";
import { WahaProvider, type WahaConfig } from "../providers/waha.js";
import type {
  ChannelRepository,
  ConnectionRecord,
  HotelProfile,
  HotelRepository,
  MessageSettingsUpdate,
} from "../repositories/types.js";

export const defaultMessageSettings: MessageSettingsUpdate = {
  emailSubjectTemplate: "Your offer from {{hotel_name}}",
  emailBodyTemplate:
    "Hello {{guest_name}},\n\nYour offer for {{check_in}} to {{check_out}} is ready.\nTotal: {{total}}\n\n{{offer_url}}",
  whatsappBodyTemplate:
    "Hello {{guest_name}}, your offer from {{hotel_name}} is ready: {{offer_url}}",
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
    private readonly publicBaseUrl: string,
    private readonly google: Partial<OAuthConfig>,
    private readonly googleProvider: GoogleProvider,
    private readonly wahaProvider: WahaProvider,
    private readonly waha: WahaPlatformConfig = {},
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
    return this.renderPreview(hotel, settings, input);
  }

  async testSend(userId: string, input: TestSendInput) {
    const hotel = await this.requireHotel(userId);
    const settings = await this.effectiveSettings(userId);
    const rendered = this.renderPreview(hotel, settings, input);
    const connectionKind = input.channel === "email" ? "google" : "waha";
    const connection = await this.repository.findConnectionForUser(userId, connectionKind);
    if (connection?.state !== "connected" || !connection.encryptedCredentials) {
      return this.saveTestResult(userId, input, rendered, {
        provider: "fake",
        accepted: false,
        state: "unknown",
        providerMessageId: null,
        lastErrorCode: "FAKE_PROVIDER",
        lastErrorMessage: "No external provider call was made.",
      });
    }

    try {
      if (input.channel === "email") {
        const config = this.requireGoogleConfig();
        const credentials = parseGoogleCredentials(
          JSON.parse(unsealPrivateValue(connection.encryptedCredentials, this.authSecret)) as unknown,
        );
        if (!("subject" in rendered) || typeof rendered.html !== "string") {
          throw new ProviderError("GMAIL_MESSAGE_INVALID", false);
        }
        const sent = await this.googleProvider.send(credentials, config, {
          to: input.recipient,
          subject: rendered.subject,
          html: rendered.html,
        });
        await this.repository.updateConnectionForHotel({
          hotelId: hotel.id,
          kind: "google",
          state: "connected",
          encryptedCredentials: sealPrivateValue(JSON.stringify(sent.credentials), this.authSecret),
          lastCheckedAt: new Date(),
          lastErrorCode: null,
        });
        return this.saveTestResult(userId, input, rendered, {
          provider: "gmail",
          accepted: true,
          state: "provider_accepted",
          providerMessageId: sent.providerMessageId,
          lastErrorCode: null,
          lastErrorMessage: null,
        });
      }

      const sent = await this.wahaProvider.sendText(
        this.wahaConfig(connection),
        input.recipient,
        rendered.text,
      );
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
        lastCheckedAt: new Date(),
        lastErrorCode: failure.code,
      });
      return this.saveTestResult(userId, input, rendered, {
        provider: connectionKind === "google" ? "gmail" : "waha",
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
    const mail = records.find((record) => ["google", "microsoft", "smtp"].includes(record.kind) && record.state === "connected")
      ?? records.find((record) => ["google", "microsoft", "smtp"].includes(record.kind)) ?? null;
    return [this.publicMailConnection(mail), this.publicConnection("waha", records.find((record) => record.kind === "waha") ?? null)];
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
    const prepared = await this.wahaProvider.prepareSession(config);
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
      const updated = await this.repository.updateConnectionForHotel({
        hotelId: hotel.id,
        kind: "waha",
        state: status.working ? "connected" : "attention",
        metadata: { ...current.metadata, sessionStatus: status.status },
        lastCheckedAt: now,
        lastErrorCode: status.working ? null : `WAHA_SESSION_${status.status}`,
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
      const completed = await this.repository.updateConnectionForHotel({
        hotelId: connection.hotelId,
        kind: "google",
        state: "connected",
        encryptedCredentials: sealPrivateValue(JSON.stringify(credentials), this.authSecret),
        metadata: {
          connectedAt: now.toISOString(),
          scope: credentials.scope,
        },
        lastCheckedAt: now,
        lastErrorCode: null,
      });
      if (!completed) throw new ProviderError("GOOGLE_CONNECTION_NOT_FOUND", false);
      return { status: "connected" as const, connection: this.publicConnection("google", completed) };
    } catch (error) {
      const failure = providerFailure(error, "GOOGLE_TOKEN");
      await this.repository.updateConnectionForHotel({
        hotelId: connection.hotelId,
        kind: "google",
        state: "attention",
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

  private renderPreview(
    hotel: HotelProfile,
    settings: MessageSettingsUpdate,
    input: PreviewInput,
  ) {
    const sample = {
      guestName: input.sample?.guestName ?? "Mario Rossi",
      checkIn: input.sample?.checkIn ?? "2027-06-10",
      checkOut: input.sample?.checkOut ?? "2027-06-12",
      guestCount: input.sample?.guestCount ?? 2,
      totalCents: input.sample?.totalCents ?? 24_000,
    };
    const values: Record<string, string> = {
      guest_name: sample.guestName,
      hotel_name: hotel.name,
      check_in: sample.checkIn,
      check_out: sample.checkOut,
      guest_count: String(sample.guestCount),
      total: new Intl.NumberFormat(hotel.locale, { style: "currency", currency: "EUR" }).format(
        sample.totalCents / 100,
      ),
      offer_url: `${this.publicBaseUrl.replace(/\/$/, "")}/proposal/preview`,
    };
    if (input.channel === "whatsapp") {
      return { channel: "whatsapp" as const, text: renderText(settings.whatsappBodyTemplate, values) };
    }
    const subject = safeHeaderText(renderText(settings.emailSubjectTemplate, values));
    const text = renderText(settings.emailBodyTemplate, values);
    const safeBody = escapeHtml(text).replace(/\n/g, "<br>");
    return {
      channel: "email" as const,
      subject,
      text,
      html: `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"></head><body style="margin:0;background:#f1f1f1;color:#202020;font-family:Poppins,Inter,Arial,sans-serif"><main style="max-width:600px;margin:0 auto;padding:32px 20px"><section style="background:#fff;border-radius:20px;padding:24px"><h1 style="font-size:22px;line-height:28px">${escapeHtml(subject)}</h1><p style="font-size:16px;line-height:24px">${safeBody}</p></section></main></body></html>`,
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
    rendered: ReturnType<ChannelService["renderPreview"]>,
    result: {
      provider: "fake" | "gmail" | "waha";
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

function providerFailure(error: unknown, fallback: string): ProviderError {
  return error instanceof ProviderError ? error : new ProviderError(`${fallback}_FAILED`, false);
}

function renderText(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/{{\s*([a-z_][a-z0-9_]*)\s*}}/g, (_match, variable: string) => values[variable] ?? "");
}
