import { errors } from "../lib/errors.js";
import { ProviderError } from "../providers/http.js";
import {
  WahaProvider,
  type WahaPlatformConfig,
  type WahaSessionSummary,
} from "../providers/waha.js";
import type {
  PlatformAdminRepository,
  PublicUser,
  WhatsAppSupportRecord,
} from "../repositories/types.js";

export class PlatformWhatsAppAdminService {
  private readonly adminEmails: Set<string>;

  constructor(
    private readonly repository: PlatformAdminRepository,
    private readonly provider: WahaProvider,
    private readonly platform: Partial<WahaPlatformConfig>,
    adminEmails: string[],
  ) {
    this.adminEmails = new Set(adminEmails.map(normalizeEmail).filter(Boolean));
  }

  access(user: PublicUser) {
    return { enabled: this.isAdmin(user) };
  }

  async list(user: PublicUser) {
    this.requireAdmin(user);
    const records = await this.repository.listWhatsAppSupportRecords();
    if (!this.platform.baseUrl || !this.platform.apiKey) {
      return {
        provider: { configured: false, reachable: false, errorCode: "WAHA_NOT_CONFIGURED" },
        counts: count(records.map((record) => publicRecord(record, null, "WAHA_NOT_CONFIGURED"))),
        sessions: records.map((record) => publicRecord(record, null, "WAHA_NOT_CONFIGURED")),
      };
    }

    let sessions: WahaSessionSummary[] = [];
    let providerErrorCode: string | null = null;
    try {
      sessions = await this.provider.listSessions({ baseUrl: this.platform.baseUrl, apiKey: this.platform.apiKey });
    } catch (error) {
      providerErrorCode = error instanceof ProviderError ? error.code : "WAHA_UNAVAILABLE";
    }
    const byName = new Map(sessions.map((session) => [session.name, session]));
    const publicSessions = records.map((record) => {
      const sessionName = stringMetadata(record, "sessionName");
      return publicRecord(record, sessionName ? (byName.get(sessionName) ?? null) : null, providerErrorCode);
    });
    return {
      provider: {
        configured: true,
        reachable: providerErrorCode === null,
        errorCode: providerErrorCode,
      },
      counts: count(publicSessions),
      sessions: publicSessions,
    };
  }

  async restart(user: PublicUser, hotelId: string) {
    this.requireAdmin(user);
    const platform = this.requirePlatform();
    const record = await this.repository.findWhatsAppSupportRecord(hotelId);
    if (!record) throw errors.hotelNotFound();
    const sessionName = stringMetadata(record, "sessionName");
    if (!record.connection || !sessionName) throw errors.providerConnectionFailed("WhatsApp");
    const now = new Date();
    try {
      const session = await this.provider.restartSession({ ...platform, sessionName });
      const connection = await this.repository.updateWhatsAppConnection({
        hotelId,
        state: session.working ? "connected" : "connecting",
        metadata: mergeProviderMetadata(record, session),
        lastCheckedAt: now,
        lastErrorCode: null,
      });
      return publicRecord({ ...record, connection }, session, null);
    } catch (error) {
      const code = error instanceof ProviderError ? error.code : "WAHA_RESTART_FAILED";
      await this.repository.updateWhatsAppConnection({
        hotelId,
        state: "attention",
        metadata: record.connection.metadata,
        lastCheckedAt: now,
        lastErrorCode: code,
      });
      throw errors.providerConnectionFailed("WhatsApp");
    }
  }

  private isAdmin(user: PublicUser): boolean {
    return this.adminEmails.has(normalizeEmail(user.email));
  }

  private requireAdmin(user: PublicUser): void {
    if (!this.isAdmin(user)) throw errors.forbidden();
  }

  private requirePlatform(): WahaPlatformConfig {
    if (!this.platform.baseUrl || !this.platform.apiKey) throw errors.configRequired("WAHA");
    return { baseUrl: this.platform.baseUrl, apiKey: this.platform.apiKey };
  }
}

function publicRecord(record: WhatsAppSupportRecord, session: WahaSessionSummary | null, providerErrorCode: string | null) {
  const configured = record.connection !== null;
  const deliveryFailureActive = Boolean(
    record.lastFailedMessageAt &&
    (!record.lastSuccessfulMessageAt || record.lastFailedMessageAt > record.lastSuccessfulMessageAt),
  );
  const cappingNeedsAttention = session?.messageCapping?.status !== undefined && session.messageCapping.status !== "NONE";
  const health = !configured
    ? "disconnected"
    : providerErrorCode
      ? "attention"
      : session?.working && !deliveryFailureActive && !cappingNeedsAttention
        ? "connected"
        : session && ["STARTING", "SCAN_QR_CODE"].includes(session.status)
          ? "connecting"
          : "attention";
  return {
    hotelId: record.hotel.id,
    hotelName: record.hotel.name,
    city: record.hotel.city,
    contactEmail: record.hotel.email,
    contactPhone: record.hotel.phone,
    configured,
    health,
    providerStatus: session?.status ?? (configured ? "NOT_FOUND" : "NOT_CONNECTED"),
    phoneNumber: session?.phoneNumber ?? stringMetadata(record, "phoneNumber"),
    pushName: session?.pushName ?? stringMetadata(record, "pushName"),
    engine: session?.engine ?? stringMetadata(record, "engine"),
    messageCapping: session?.messageCapping ?? null,
    sessionName: stringMetadata(record, "sessionName"),
    lastCheckedAt: record.connection?.lastCheckedAt?.toISOString() ?? null,
    lastSuccessfulMessageAt: record.lastSuccessfulMessageAt?.toISOString() ?? null,
    lastFailedMessageAt: record.lastFailedMessageAt?.toISOString() ?? null,
    lastErrorCode: providerErrorCode ?? record.connection?.lastErrorCode ?? record.lastDeliveryErrorCode,
  };
}

function count(records: Array<{ health: string }>) {
  return {
    total: records.length,
    connected: records.filter(({ health }) => health === "connected").length,
    connecting: records.filter(({ health }) => health === "connecting").length,
    attention: records.filter(({ health }) => health === "attention").length,
    disconnected: records.filter(({ health }) => health === "disconnected").length,
  };
}

function stringMetadata(record: WhatsAppSupportRecord, key: string): string | null {
  const value = record.connection?.metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function mergeProviderMetadata(record: WhatsAppSupportRecord, session: WahaSessionSummary) {
  return {
    ...(record.connection?.metadata ?? {}),
    providerStatus: session.status,
    phoneNumber: session.phoneNumber,
    pushName: session.pushName,
    engine: session.engine,
    messageCapping: session.messageCapping,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
