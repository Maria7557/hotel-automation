import { asRecord, type ProviderFetch, ProviderError, providerJson } from "./http.js";

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GoogleCredentials = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  scope: string | null;
  tokenType: string;
};

export type GmailMessage = {
  to: string;
  subject: string;
  html: string;
};

export class GoogleProvider {
  constructor(private readonly fetchClient: ProviderFetch) {}

  async exchangeAuthorizationCode(code: string, config: GoogleOAuthConfig): Promise<GoogleCredentials> {
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    });
    const result = await providerJson(
      this.fetchClient,
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      "GOOGLE_TOKEN",
    );
    if (!result.response.ok) {
      throw new ProviderError(`GOOGLE_TOKEN_HTTP_${result.response.status}`, result.response.status >= 500);
    }
    return parseTokenResponse(result.body, null);
  }

  async refreshAccessToken(credentials: GoogleCredentials, config: GoogleOAuthConfig): Promise<GoogleCredentials> {
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token",
    });
    const result = await providerJson(
      this.fetchClient,
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      "GOOGLE_REFRESH",
    );
    if (!result.response.ok) {
      throw new ProviderError(`GOOGLE_REFRESH_HTTP_${result.response.status}`, result.response.status >= 500);
    }
    return parseTokenResponse(result.body, credentials.refreshToken);
  }

  async send(
    credentials: GoogleCredentials,
    config: GoogleOAuthConfig,
    message: GmailMessage,
  ): Promise<{ credentials: GoogleCredentials; providerMessageId: string | null }> {
    let current = credentials;
    if (new Date(current.accessTokenExpiresAt).getTime() <= Date.now() + 60_000) {
      current = await this.refreshAccessToken(current, config);
    }
    let result = await this.sendWithAccessToken(current.accessToken, message);
    if (result.response.status === 401) {
      current = await this.refreshAccessToken(current, config);
      result = await this.sendWithAccessToken(current.accessToken, message);
    }
    if (!result.response.ok) {
      throw new ProviderError(`GMAIL_SEND_HTTP_${result.response.status}`, result.response.status === 429 || result.response.status >= 500);
    }
    const responseBody = asRecord(result.body);
    return {
      credentials: current,
      providerMessageId: typeof responseBody?.id === "string" ? responseBody.id : null,
    };
  }

  private sendWithAccessToken(accessToken: string, message: GmailMessage) {
    return providerJson(
      this.fetchClient,
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: buildRfc2822Base64Url(message) }),
      },
      "GMAIL_SEND",
    );
  }
}

export function buildRfc2822Base64Url(message: GmailMessage): string {
  const to = safeHeader(message.to);
  const subject = encodeHeader(message.subject);
  const mime = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    message.html.replace(/\r?\n/g, "\r\n"),
  ].join("\r\n");
  return Buffer.from(mime, "utf8").toString("base64url");
}

export function parseGoogleCredentials(value: unknown): GoogleCredentials {
  const record = asRecord(value);
  if (
    !record ||
    typeof record.accessToken !== "string" ||
    typeof record.refreshToken !== "string" ||
    typeof record.accessTokenExpiresAt !== "string"
  ) {
    throw new ProviderError("GOOGLE_CREDENTIALS_INVALID", false);
  }
  return {
    accessToken: record.accessToken,
    refreshToken: record.refreshToken,
    accessTokenExpiresAt: record.accessTokenExpiresAt,
    scope: typeof record.scope === "string" ? record.scope : null,
    tokenType: typeof record.tokenType === "string" ? record.tokenType : "Bearer",
  };
}

function parseTokenResponse(value: unknown, existingRefreshToken: string | null): GoogleCredentials {
  const record = asRecord(value);
  const refreshToken = typeof record?.refresh_token === "string" ? record.refresh_token : existingRefreshToken;
  if (
    !record ||
    typeof record.access_token !== "string" ||
    typeof record.expires_in !== "number" ||
    !refreshToken
  ) {
    throw new ProviderError("GOOGLE_TOKEN_RESPONSE_INVALID", false);
  }
  return {
    accessToken: record.access_token,
    refreshToken,
    accessTokenExpiresAt: new Date(Date.now() + record.expires_in * 1_000).toISOString(),
    scope: typeof record.scope === "string" ? record.scope : null,
    tokenType: typeof record.token_type === "string" ? record.token_type : "Bearer",
  };
}

function safeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodeHeader(value: string): string {
  const safe = safeHeader(value);
  return /^[\x20-\x7E]*$/.test(safe)
    ? safe
    : `=?UTF-8?B?${Buffer.from(safe, "utf8").toString("base64")}?=`;
}
