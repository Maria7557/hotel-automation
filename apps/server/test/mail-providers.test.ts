import { describe, expect, it, vi } from "vitest";
import { detectMailProvider } from "../src/services/mail-detection.js";
import { parseSmtpCredentials, resolveSafeSmtpHost } from "../src/providers/smtp.js";
import { MicrosoftProvider } from "../src/providers/microsoft.js";

describe("mail provider detection", () => {
  it("detects Gmail without DNS", async () => expect(await detectMailProvider("hotel@gmail.com", vi.fn())).toEqual({ provider: "google", confidence: "high" }));
  it("detects Google Workspace from MX", async () => expect(await detectMailProvider("booking@hotel.it", async () => [{ exchange: "aspmx.l.google.com", priority: 1 }])).toMatchObject({ provider: "google" }));
  it("detects Microsoft 365 from MX", async () => expect(await detectMailProvider("booking@hotel.it", async () => [{ exchange: "hotel-it.mail.protection.outlook.com", priority: 1 }])).toMatchObject({ provider: "microsoft" }));
  it("falls back to SMTP", async () => expect(await detectMailProvider("booking@hotel.it", async () => [{ exchange: "mail.hotel.it", priority: 1 }])).toMatchObject({ provider: "smtp" }));
});

describe("SMTP SSRF protection", () => {
  it.each(["localhost", "mail.local", "metadata.google.internal"])("rejects %s", async (host) => expect(resolveSafeSmtpHost(host, async () => [{ address: "93.184.216.34", family: 4 }])).rejects.toMatchObject({ code: "SMTP_HOST_FORBIDDEN" }));
  it.each(["127.0.0.1", "10.0.0.2", "169.254.169.254", "192.168.1.1"])("rejects private result %s", async (address) => expect(resolveSafeSmtpHost("mail.hotel.it", async () => [{ address, family: 4 }])).rejects.toMatchObject({ code: "SMTP_HOST_FORBIDDEN" }));
  it("accepts a public result", async () => expect(resolveSafeSmtpHost("mail.hotel.it", async () => [{ address: "93.184.216.34", family: 4 }])).resolves.toMatchObject({ hostname: "mail.hotel.it" }));
  it.each([[465, "tls"], [587, "starttls"]] as const)("accepts secure port %s", (port, encryption) => expect(parseSmtpCredentials({ email: "booking@hotel.it", hostname: "mail.hotel.it", port, username: "booking", appPassword: "secret", encryption })).toMatchObject({ port, encryption }));
  it("rejects mismatched port encryption", () => expect(() => parseSmtpCredentials({ email: "booking@hotel.it", hostname: "mail.hotel.it", port: 587, username: "booking", appPassword: "secret", encryption: "tls" })).toThrow());
});

describe("Microsoft Graph", () => {
  it("refreshes and sends through /me/sendMail", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "new", refresh_token: "refresh2", expires_in: 3600, scope: "Mail.Send" }), { status: 200, headers: { "content-type": "application/json" } })).mockResolvedValueOnce(new Response(null, { status: 202, headers: { "request-id": "request-1" } }));
    const provider = new MicrosoftProvider(fetcher);
    const result = await provider.send({ accessToken: "old", refreshToken: "refresh", accessTokenExpiresAt: new Date(0).toISOString(), scope: null }, { clientId: "id", clientSecret: "secret", redirectUri: "https://example.com/callback" }, { to: "owner@example.com", subject: "Test", html: "<p>Test</p>" });
    expect(result.providerMessageId).toBe("request-1"); expect(fetcher.mock.calls[1]?.[0]).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    expect(String(fetcher.mock.calls[1]?.[1]?.body)).toContain('"saveToSentItems":true');
  });
});
