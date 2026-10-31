import { asRecord, type ProviderFetch, ProviderError, providerJson } from "./http.js";

export type WahaConfig = { baseUrl: string; apiKey: string; sessionName: string };

export class WahaProvider {
  constructor(private readonly fetchClient: ProviderFetch) {}

  async sessionStatus(config: WahaConfig): Promise<{ status: string; working: boolean }> {
    const result = await providerJson(
      this.fetchClient,
      `${config.baseUrl}/api/sessions/${encodeURIComponent(config.sessionName)}`,
      { method: "GET", headers: headers(config.apiKey) },
      "WAHA_STATUS",
    );
    if (!result.response.ok) {
      throw new ProviderError(`WAHA_STATUS_HTTP_${result.response.status}`, result.response.status >= 500);
    }
    const body = asRecord(result.body);
    if (!body || typeof body.status !== "string") throw new ProviderError("WAHA_STATUS_RESPONSE_INVALID", false);
    return {
      status: body.status,
      working: body.status === "WORKING" && body.me !== null && body.me !== undefined,
    };
  }

  async sendText(config: WahaConfig, phone: string, text: string) {
    const chatId = toWahaChatId(phone);
    const result = await providerJson(
      this.fetchClient,
      `${config.baseUrl}/api/sendText`,
      {
        method: "POST",
        headers: headers(config.apiKey),
        body: JSON.stringify({ session: config.sessionName, chatId, text }),
      },
      "WAHA_SEND",
    );
    if (!result.response.ok) {
      throw new ProviderError(`WAHA_SEND_HTTP_${result.response.status}`, result.response.status === 429 || result.response.status >= 500);
    }
    return { providerMessageId: messageId(result.body), chatId };
  }
}

export function toWahaChatId(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) throw new ProviderError("WAHA_PHONE_INVALID", false);
  return `${digits}@c.us`;
}

function headers(apiKey: string): Record<string, string> {
  return { Accept: "application/json", "Content-Type": "application/json", "X-Api-Key": apiKey };
}

function messageId(value: unknown): string | null {
  const record = asRecord(value);
  if (typeof record?.id === "string") return record.id;
  const key = asRecord(record?.key);
  if (typeof key?.id === "string") return key.id;
  return null;
}
