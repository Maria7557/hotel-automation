import { AppError } from "../lib/errors.js";
import { jobContext } from "../monitoring/scope.js";
import { monitoredJob, jobOutcome, type Monitor } from "../monitoring/workflows.js";

export interface ClientWorkerRepository {
  nextHotel(now: Date): Promise<string | null>;
  pending(hotelId: string, now: Date, limit: number): Promise<string[]>;
  syncInquiry(hotelId: string, inquiryId: string): Promise<unknown>;
  recordFailure(hotelId: string, inquiryId: string, now: Date, code: string): Promise<void>;
}
export type ClientWorkerLogger = { error(fields: Record<string, unknown>, message: string): void; info(fields: Record<string, unknown>, message: string): void };

export class ClientWorker {
  constructor(private readonly repository: ClientWorkerRepository, private readonly logger: ClientWorkerLogger, private readonly batchSize = 25, private readonly monitor?: Monitor | null) {}

  async processBatch(now = new Date()): Promise<number> {
    const hotelId = await this.repository.nextHotel(now);
    if (!hotelId) return 0;
    const ids = await this.repository.pending(hotelId, now, this.batchSize);
    let processed = 0;
    for (const inquiryId of ids) {
      await monitoredJob(this.monitor, "contact.sync", { ...jobContext(null), companyId: hotelId, placement: "clientWorker.syncInquiry", attributes: { jobId: inquiryId } }, async () => {
        try {
          await this.repository.syncInquiry(hotelId, inquiryId);
          processed++;
          jobOutcome(this.monitor, "contact.sync", "completed");
        } catch (error) {
          const code = error instanceof AppError ? error.code : "CLIENT_SYNC_FAILED";
          // No guest names or contact information in logs.
          this.logger.error({ hotelId, inquiryId, code }, "Contact processing deferred");
          await this.repository.recordFailure(hotelId, inquiryId, now, code).catch(() => undefined);
          jobOutcome(this.monitor, "contact.sync", "retry", { failureCode: code, failedStep: "clientWorker.syncInquiry" });
        }
      });
    }
    this.logger.info({ hotelId, processed, attempted: ids.length }, "Contact batch completed");
    return processed;
  }
}

export class ClientWorkerLoop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private stopped = true;
  constructor(private readonly worker: ClientWorker, private readonly intervalMs: number, private readonly logger: ClientWorkerLogger) {}
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }
  private schedule(delay: number) {
    this.timer = setTimeout(() => {
      this.running = this.worker.processBatch().then(() => undefined).catch(() => {
        this.logger.error({ code: "CLIENT_WORKER_UNAVAILABLE" }, "Contact worker will retry after its interval");
      }).finally(() => { this.running = null; if (!this.stopped) this.schedule(this.intervalMs); });
    }, delay);
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }
}
