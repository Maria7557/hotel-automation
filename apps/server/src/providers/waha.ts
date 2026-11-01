import { asRecord, type ProviderFetch, ProviderError, providerJson } from "./http.js";

export type WahaConfig = { baseUrl: string; apiKey: string; sessionName: string };
export type WahaPlatformConfig = Omit<WahaConfig, "sessionName">;
export type WahaSessionSummary = {
  name: string;
  status: string;
  working: boolean;
  phoneNumber: string | null;
  pushName: string | null;
  engine: string | null;
  messageCapping: {
    status: string;
    totalQuota: number | null;
    usedQuota: number | null;
    cycleEnd: number | null;
  } | null;
};

export class WahaProvider {
  constructor(private readonly fetchClient: ProviderFetch) {}

  async prepareSession(config: WahaConfig): Promise<{ status: string; working: boolean }> {
    const current = await providerJson(
      this.fetchClient,
      `${config.baseUrl}/api/sessions/${encodeURIComponent(config.sessionName)}`,
      { method: "GET", headers: headers(config.apiKey) },
      "WAHA_STATUS",
    );

    if (current.response.status === 404) {
      const created = await providerJson(
        this.fetchClient,
        `${config.baseUrl}/api/sessions`,
        {
          method: "POST",
          headers: headers(config.apiKey),
          body: JSON.stringify({
            name: config.sessionName,
            start: true,
            config: {
              client: { deviceName: "Hotel Automation", browserName: "Chrome" },
            },
          }),
        },
        "WAHA_SESSION_CREATE",
      );
      if (!created.response.ok) {
        throw new ProviderError(
          `WAHA_SESSION_CREATE_HTTP_${created.response.status}`,
          created.response.status === 429 || created.response.status >= 500,
        );
      }
      return sessionState(created.body, "WAHA_SESSION_CREATE_RESPONSE_INVALID");
    }

    if (!current.response.ok) {
      throw new ProviderError(
        `WAHA_STATUS_HTTP_${current.response.status}`,
        current.response.status === 429 || current.response.status >= 500,
      );
    }

    const state = sessionState(current.body, "WAHA_STATUS_RESPONSE_INVALID");
    if (state.working || ["STARTING", "SCAN_QR_CODE"].includes(state.status)) return state;

    const action = state.status === "FAILED" ? "restart" : "start";
    const started = await providerJson(
      this.fetchClient,
      `${config.baseUrl}/api/sessions/${encodeURIComponent(config.sessionName)}/${action}`,
      { method: "POST", headers: headers(config.apiKey), body: "{}" },
      `WAHA_SESSION_${action.toUpperCase()}`,
    );
    if (!started.response.ok) {
      throw new ProviderError(
        `WAHA_SESSION_${action.toUpperCase()}_HTTP_${started.response.status}`,
        started.response.status === 429 || started.response.status >= 500,
      );
    }
    return sessionState(started.body, `WAHA_SESSION_${action.toUpperCase()}_RESPONSE_INVALID`);
  }

  async qrCode(config: WahaConfig): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchClient(
        `${config.baseUrl}/api/${encodeURIComponent(config.sessionName)}/auth/qr`,
        { method: "GET", headers: headers(config.apiKey), signal: AbortSignal.timeout(10_000) },
      );
    } catch (error) {
      if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
        throw new ProviderError("WAHA_QR_TIMEOUT", true);
      }
      throw new ProviderError("WAHA_QR_NETWORK_ERROR", true, true);
    }
    if (!response.ok) {
      throw new ProviderError(
        `WAHA_QR_HTTP_${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.startsWith("image/png") || contentType.startsWith("image/jpeg")) {
      const data = Buffer.from(await response.arrayBuffer()).toString("base64");
      if (!data) throw new ProviderError("WAHA_QR_RESPONSE_INVALID", false);
      const mimetype = contentType.startsWith("image/jpeg") ? "image/jpeg" : "image/png";
      return `data:${mimetype};base64,${data}`;
    }
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      // WAHA editions return either an image body or JSON containing base64 data.
    }
    const body = asRecord(parsed);
    if (!body || typeof body.data !== "string" || body.data.length === 0) {
      throw new ProviderError("WAHA_QR_RESPONSE_INVALID", false);
    }
    const mimetype = body.mimetype === "image/jpeg" ? "image/jpeg" : "image/png";
    return `data:${mimetype};base64,${body.data}`;
  }

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
    return sessionState(result.body, "WAHA_STATUS_RESPONSE_INVALID");
  }

  async listSessions(config: WahaPlatformConfig): Promise<WahaSessionSummary[]> {
    const result = await providerJson(
      this.fetchClient,
      `${config.baseUrl}/api/sessions?all=true`,
      { method: "GET", headers: headers(config.apiKey) },
      "WAHA_SESSION_LIST",
    );
    if (!result.response.ok) {
      throw new ProviderError(
        `WAHA_SESSION_LIST_HTTP_${result.response.status}`,
        result.response.status === 429 || result.response.status >= 500,
      );
    }
    if (!Array.isArray(result.body)) throw new ProviderError("WAHA_SESSION_LIST_RESPONSE_INVALID", false);
    return result.body.map((session) => sessionSummary(session));
  }

  async restartSession(config: WahaConfig): Promise<WahaSessionSummary> {
    const result = await providerJson(
      this.fetchClient,
      `${config.baseUrl}/api/sessions/${encodeURIComponent(config.sessionName)}/restart`,
      { method: "POST", headers: headers(config.apiKey), body: "{}" },
      "WAHA_SESSION_RESTART",
    );
    if (!result.response.ok) {
      throw new ProviderError(
        `WAHA_SESSION_RESTART_HTTP_${result.response.status}`,
        result.response.status === 429 || result.response.status >= 500,
      );
    }
    return sessionSummary(result.body);
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

function sessionSummary(value: unknown): WahaSessionSummary {
  const body = asRecord(value);
  if (!body || typeof body.name !== "string" || typeof body.status !== "string") {
    throw new ProviderError("WAHA_SESSION_RESPONSE_INVALID", false);
  }
  const me = asRecord(body.me);
  const rawId = typeof me?.id === "string" ? me.id : null;
  const capping = asRecord(me?.messageCapping);
  return {
    name: body.name,
    status: body.status,
    working: body.status === "WORKING" && me !== null,
    phoneNumber: rawId ? rawId.split("@")[0]?.replace(/\D/g, "") || null : null,
    pushName: typeof me?.pushName === "string" ? me.pushName : null,
    engine: typeof body.engine === "string" ? body.engine : null,
    messageCapping: capping && typeof capping.cappingStatus === "string" ? {
      status: capping.cappingStatus,
      totalQuota: numberOrNull(capping.totalQuota),
      usedQuota: numberOrNull(capping.usedQuota),
      cycleEnd: numberOrNull(capping.cycleEnd),
    } : null,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sessionState(value: unknown, errorCode: string): { status: string; working: boolean } {
  const body = asRecord(value);
  if (!body || typeof body.status !== "string") throw new ProviderError(errorCode, false);
  return {
    status: body.status,
    working: body.status === "WORKING" && body.me !== null && body.me !== undefined,
  };
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
