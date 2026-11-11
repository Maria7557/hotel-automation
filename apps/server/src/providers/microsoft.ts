import { asRecord, type ProviderFetch, ProviderError, providerJson } from "./http.js";
import type { GmailMessage } from "./google.js";

export type MicrosoftOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };
export type MicrosoftCredentials = { accessToken: string; refreshToken: string; accessTokenExpiresAt: string; scope: string | null };

export class MicrosoftProvider {
  constructor(private readonly fetchClient: ProviderFetch) {}

  async exchangeAuthorizationCode(code: string, config: MicrosoftOAuthConfig) {
    return this.token({ code, grant_type: "authorization_code", redirect_uri: config.redirectUri }, config, null);
  }

  async refreshAccessToken(credentials: MicrosoftCredentials, config: MicrosoftOAuthConfig, signal?: AbortSignal) {
    return this.token({ refresh_token: credentials.refreshToken, grant_type: "refresh_token" }, config, credentials.refreshToken, signal);
  }

  async send(credentials: MicrosoftCredentials, config: MicrosoftOAuthConfig, message: GmailMessage, onRefresh?: (credentials: MicrosoftCredentials) => Promise<void>, signal?: AbortSignal) {
    let current = credentials;
    if (new Date(current.accessTokenExpiresAt).getTime() <= Date.now() + 60_000) {
      current = await this.refreshAccessToken(current, config, signal);
      await onRefresh?.(current);
    }
    let response = await this.sendWithToken(current.accessToken, message, signal);
    if (response.status === 401) {
      current = await this.refreshAccessToken(current, config, signal);
      await onRefresh?.(current);
      response = await this.sendWithToken(current.accessToken, message, signal);
    }
    if (!response.ok) throw new ProviderError(`MICROSOFT_SEND_HTTP_${response.status}`, response.status === 429 || response.status >= 500);
    return { credentials: current, providerMessageId: response.headers.get("request-id") };
  }

  private async sendWithToken(token: string, message: GmailMessage, signal?: AbortSignal) {
    try {
      return await this.fetchClient("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { subject: message.subject, body: { contentType: "HTML", content: message.html }, toRecipients: [{ emailAddress: { address: message.to } }] }, saveToSentItems: true }),
      });
    } catch (error) {
      const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
      throw new ProviderError(timeout ? "MICROSOFT_SEND_TIMEOUT" : "MICROSOFT_SEND_NETWORK_ERROR", true, true);
    }
  }

  private async token(fields: Record<string, string>, config: MicrosoftOAuthConfig, existing: string | null, signal?: AbortSignal): Promise<MicrosoftCredentials> {
    const result = await providerJson(this.fetchClient, "https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      ...(signal ? { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) } : {}),
      body: new URLSearchParams({ ...fields, client_id: config.clientId, client_secret: config.clientSecret, scope: "openid profile email offline_access Mail.Send" }),
    }, "MICROSOFT_TOKEN");
    if (!result.response.ok) throw new ProviderError(`MICROSOFT_TOKEN_HTTP_${result.response.status}`, result.response.status >= 500);
    return parseMicrosoftCredentials(result.body, existing);
  }
}

// Stored credentials use camelCase. Keep accepting token responses for existing callers.
export function parseMicrosoftCredentials(value: unknown, existingRefreshToken: string | null = null): MicrosoftCredentials {
  const record = asRecord(value);
  if (record && ("accessToken" in record || "accessTokenExpiresAt" in record)) {
    if (
      typeof record.accessToken !== "string" || !record.accessToken ||
      typeof record.refreshToken !== "string" || !record.refreshToken ||
      typeof record.accessTokenExpiresAt !== "string" ||
      !Number.isFinite(Date.parse(record.accessTokenExpiresAt))
    ) throw new ProviderError("MICROSOFT_CREDENTIALS_INVALID", false);
    return {
      accessToken: record.accessToken,
      refreshToken: record.refreshToken,
      accessTokenExpiresAt: record.accessTokenExpiresAt,
      scope: typeof record.scope === "string" ? record.scope : null,
    };
  }
  const refreshToken = typeof record?.refresh_token === "string" ? record.refresh_token : existingRefreshToken;
  if (!record || typeof record.access_token !== "string" || !record.access_token ||
    typeof record.expires_in !== "number" || !Number.isFinite(record.expires_in) || record.expires_in <= 0 || !refreshToken) {
    throw new ProviderError("MICROSOFT_TOKEN_RESPONSE_INVALID", false);
  }
  const expiresAt = Date.now() + record.expires_in * 1000;
  if (!Number.isFinite(new Date(expiresAt).getTime())) throw new ProviderError("MICROSOFT_TOKEN_RESPONSE_INVALID", false);
  return { accessToken: record.access_token, refreshToken, accessTokenExpiresAt: new Date(expiresAt).toISOString(), scope: typeof record.scope === "string" ? record.scope : null };
}
