// No dashboard state lives here. Only the indicator for the affected request re-renders.
export type ClientStatus = "loading" | "present" | "missing" | "error";
type StatusResult = { inquiryId: string; inContacts: boolean; clientId?: string | null };
export class ClientStatusStore {
  private readonly values = new Map<string, ClientStatus>();
  private readonly clientIds = new Map<string, string>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private polling: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private disposed = false;
  private readonly versions = new Map<string, number>();
  constructor(private readonly fetchStatuses: (ids: string[]) => Promise<StatusResult[]>, private readonly delay = 250, private readonly refreshMs = 60_000) {}
  get(id: string): ClientStatus { return this.values.get(id) ?? "loading"; }
  getClientId(id: string): string | null { return this.clientIds.get(id) ?? null; }
  subscribe(id: string, callback: () => void): () => void {
    const listeners = this.listeners.get(id) ?? new Set();
    listeners.add(callback);
    this.listeners.set(id, listeners);
    if (!this.values.has(id)) this.enqueue(id);
    if (!this.polling) this.polling = setInterval(() => this.refresh(), this.refreshMs);
    return () => {
      listeners.delete(callback);
      if (!listeners.size) this.listeners.delete(id);
      if (!this.listeners.size && this.polling) { clearInterval(this.polling); this.polling = null; }
    };
  }
  markPresent(id: string, clientId?: string) {
    this.versions.set(id, (this.versions.get(id) ?? 0) + 1);
    this.pending.delete(id);
    this.set(id, "present", clientId);
  }
  refresh() { for (const id of this.listeners.keys()) this.enqueue(id); }
  retry(id: string) { this.enqueue(id); }
  private set(id: string, value: ClientStatus, clientId?: string) {
    const nextClientId = value === "present" ? clientId ?? this.clientIds.get(id) : undefined;
    if (this.values.get(id) === value && this.clientIds.get(id) === nextClientId) return;
    this.values.set(id, value);
    if (nextClientId) this.clientIds.set(id, nextClientId); else this.clientIds.delete(id);
    for (const listener of this.listeners.get(id) ?? []) listener();
  }
  private enqueue(id: string) {
    if (this.disposed) return;
    this.pending.add(id);
    if (!this.inFlight && !this.timer) this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.delay);
  }
  private async flush() {
    if (this.disposed || this.inFlight) return;
    const ids = [...this.pending].filter((id) => this.listeners.has(id)).slice(0, 100);
    for (const id of [...this.pending]) { if (ids.includes(id) || !this.listeners.has(id)) this.pending.delete(id); }
    if (!ids.length) return;
    this.inFlight = true;
    const versions = ids.map((id) => this.versions.get(id) ?? 0);
    try {
      const statuses = new Map((await this.fetchStatuses(ids)).map((s) => [s.inquiryId, s]));
      ids.forEach((id, i) => {
        if (this.disposed || (this.versions.get(id) ?? 0) !== versions[i]) return;
        const result = statuses.get(id);
        this.set(id, !result ? "error" : result.inContacts ? "present" : "missing", result?.clientId ?? undefined);
      });
    } catch {
      ids.forEach((id, i) => { if (!this.disposed && (this.versions.get(id) ?? 0) === versions[i]) this.set(id, "error"); });
    } finally {
      this.inFlight = false;
      if (!this.disposed && this.pending.size) this.enqueue([...this.pending][0]!);
    }
  }
  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.polling) clearInterval(this.polling);
    this.listeners.clear();
    this.pending.clear();
  }
}
