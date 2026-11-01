import { asRecord, type ProviderFetch, ProviderError, providerJson } from "./http.js";
import type { GmailMessage } from "./google.js";

export type MicrosoftOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };
export type MicrosoftCredentials = { accessToken: string; refreshToken: string; accessTokenExpiresAt: string; scope: string | null };

export class MicrosoftProvider {
  constructor(private readonly fetchClient: ProviderFetch) {}

  async exchangeAuthorizationCode(code: string, config: MicrosoftOAuthConfig) {
    return this.token({ code, grant_type: "authorization_code", redirect_uri: config.redirectUri }, config, null);
  }

  async refreshAccessToken(credentials: MicrosoftCredentials, config: MicrosoftOAuthConfig) {
    return this.token({ refresh_token: credentials.refreshToken, grant_type: "refresh_token" }, config, credentials.refreshToken);
  }

  async send(credentials: MicrosoftCredentials, config: MicrosoftOAuthConfig, message: GmailMessage) {
    let current = credentials;
    if (new Date(current.accessTokenExpiresAt).getTime() <= Date.now() + 60_000) current = await this.refreshAccessToken(current, config);
    let response = await this.sendWithToken(current.accessToken, message);
    if (response.status === 401) {
      current = await this.refreshAccessToken(current, config);
      response = await this.sendWithToken(current.accessToken, message);
    }
    if (!response.ok) throw new ProviderError(`MICROSOFT_SEND_HTTP_${response.status}`, response.status === 429 || response.status >= 500);
    return { credentials: current, providerMessageId: response.headers.get("request-id") };
  }

  private sendWithToken(token: string, message: GmailMessage) {
    return this.fetchClient("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { subject: message.subject, body: { contentType: "HTML", content: message.html }, toRecipients: [{ emailAddress: { address: message.to } }] }, saveToSentItems: true }),
    });
  }

  private async token(fields: Record<string, string>, config: MicrosoftOAuthConfig, existing: string | null): Promise<MicrosoftCredentials> {
    const result = await providerJson(this.fetchClient, "https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, client_id: config.clientId, client_secret: config.clientSecret, scope: "openid profile email offline_access Mail.Send" }),
    }, "MICROSOFT_TOKEN");
    if (!result.response.ok) throw new ProviderError(`MICROSOFT_TOKEN_HTTP_${result.response.status}`, result.response.status >= 500);
    return parseMicrosoftCredentials(result.body, existing);
  }
}

export function parseMicrosoftCredentials(value: unknown, existingRefreshToken: string | null = null): MicrosoftCredentials {
  const record = asRecord(value); const refreshToken = typeof record?.refresh_token === "string" ? record.refresh_token : existingRefreshToken;
  if (!record || typeof record.access_token !== "string" || typeof record.expires_in !== "number" || !refreshToken) throw new ProviderError("MICROSOFT_TOKEN_RESPONSE_INVALID", false);
  return { accessToken: record.access_token, refreshToken, accessTokenExpiresAt: new Date(Date.now() + record.expires_in * 1000).toISOString(), scope: typeof record.scope === "string" ? record.scope : null };
}
