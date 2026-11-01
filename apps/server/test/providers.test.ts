import { describe, expect, it, vi } from "vitest";

import { GoogleProvider } from "../src/providers/google.js";
import type { ProviderFetch } from "../src/providers/http.js";
import { WahaProvider, toWahaChatId } from "../src/providers/waha.js";
import { sealPrivateValue, unsealPrivateValue } from "../src/lib/public-token.js";

describe("provider adapters", () => {
  it("round-trips AES-GCM sealed values and rejects tampering", () => {
    const secret = "test-auth-secret-that-is-at-least-32-characters";
    const sealed = sealPrivateValue("private-token", secret);
    expect(unsealPrivateValue(sealed, secret)).toBe("private-token");
    const parts = sealed.split(".");
    parts[3] = `${parts[3]?.startsWith("A") ? "B" : "A"}${parts[3]?.slice(1)}`;
    expect(() => unsealPrivateValue(parts.join("."), secret)).toThrow("Invalid sealed value");
  });

  it("refreshes Google access, builds RFC 2822 base64url, and sends through Gmail", async () => {
    const mock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      if (String(input) === "https://oauth2.googleapis.com/token") {
        return json({ access_token: "fresh-access", expires_in: 3600, token_type: "Bearer" });
      }
      return json({ id: "gmail-id" });
    });
    const provider = new GoogleProvider(mock as ProviderFetch);
    const result = await provider.send(
      {
        accessToken: "expired-access",
        refreshToken: "refresh-token",
        accessTokenExpiresAt: new Date(0).toISOString(),
        scope: "https://www.googleapis.com/auth/gmail.send",
        tokenType: "Bearer",
      },
      { clientId: "client", clientSecret: "secret", redirectUri: "https://api.example/callback" },
      { to: "guest@example.com", subject: "Offer", html: "<strong>Hello</strong>" },
    );
    expect(result).toMatchObject({ providerMessageId: "gmail-id", credentials: { accessToken: "fresh-access" } });
    const refreshCall = mock.mock.calls[0];
    expect(String(refreshCall?.[1]?.body)).toContain("grant_type=refresh_token");
    expect(String(refreshCall?.[1]?.body)).toContain("refresh_token=refresh-token");
    const sendCall = mock.mock.calls[1];
    expect(sendCall?.[1]?.headers).toMatchObject({ Authorization: "Bearer fresh-access" });
    const raw = JSON.parse(String(sendCall?.[1]?.body)).raw as string;
    expect(raw).not.toContain("=");
    expect(Buffer.from(raw, "base64url").toString("utf8")).toBe(
      "To: guest@example.com\r\nSubject: Offer\r\nMIME-Version: 1.0\r\n" +
        "Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n" +
        "<strong>Hello</strong>",
    );
  });

  it("uses WAHA X-Api-Key, session health, and normalized E.164 chat ids", async () => {
    const mock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/sessions/")) {
        return json({ status: "WORKING", me: { id: "393331234567@c.us" } });
      }
      if (url.includes("/api/contacts/check-exists")) {
        return json({ numberExists: true, chatId: "89902624575692@lid", pn: "393331234567@c.us" });
      }
      return json({ key: { id: "waha-id" } });
    });
    const provider = new WahaProvider(mock as ProviderFetch);
    const config = { baseUrl: "https://waha.example", apiKey: "api-secret", sessionName: "hotel-main" };
    expect(await provider.sessionStatus(config)).toEqual({ status: "WORKING", working: true });
    expect(await provider.sendText(config, "+39 333-123-4567", "Hello")).toEqual({
      providerMessageId: "waha-id",
      chatId: "89902624575692@lid",
    });
    expect(mock.mock.calls[2]?.[1]?.headers).toMatchObject({ "X-Api-Key": "api-secret" });
    expect(JSON.parse(String(mock.mock.calls[2]?.[1]?.body))).toMatchObject({
      chatId: "89902624575692@lid",
    });
    expect(toWahaChatId("+39 333-123-4567")).toBe("393331234567@c.us");
  });

  it("does not send WhatsApp messages to numbers WAHA cannot resolve", async () => {
    const mock = vi.fn(async () => json({ numberExists: false, chatId: null }));
    const provider = new WahaProvider(mock as ProviderFetch);
    const config = { baseUrl: "https://waha.example", apiKey: "api-secret", sessionName: "hotel-main" };

    await expect(provider.sendText(config, "+971 50 555 4801", "Hello"))
      .rejects.toMatchObject({ code: "WAHA_PHONE_NOT_REGISTERED", retryable: false });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("creates a WAHA session and returns a data URL for its QR code", async () => {
    const mock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/sessions/hotel-1") && init?.method === "GET") {
        return json({ message: "not found" }, 404);
      }
      if (url.endsWith("/api/sessions") && init?.method === "POST") {
        return json({ name: "hotel-1", status: "SCAN_QR_CODE", me: null });
      }
      if (url.endsWith("/api/hotel-1/auth/qr")) {
        return new Response(Buffer.from("qr-bytes"), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }
      throw new Error(`Unexpected provider URL: ${url}`);
    });
    const provider = new WahaProvider(mock as ProviderFetch);
    const config = { baseUrl: "https://waha.example", apiKey: "platform-secret", sessionName: "hotel-1" };

    expect(await provider.prepareSession(config)).toEqual({ status: "SCAN_QR_CODE", working: false });
    expect(await provider.qrCode(config)).toBe("data:image/png;base64,cXItYnl0ZXM=");
    expect(mock.mock.calls[1]?.[1]?.headers).toMatchObject({ "X-Api-Key": "platform-secret" });
    expect(JSON.parse(String(mock.mock.calls[1]?.[1]?.body))).toMatchObject({
      name: "hotel-1",
      start: true,
    });
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
