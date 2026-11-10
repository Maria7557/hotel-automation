import { z } from "zod";

export const DASHBOARD_PAGE_SIZE = 30;
export const AUTOMATIC_SENDING_TIMEOUT_MS = 15 * 60_000;
export const AUTOMATIC_SENDING_TIMEOUT_REASON = "automatic_sending_timeout";
export const dashboardQuerySchema = z.object({
  status: z.enum(["all", "new", "waiting", "payment", "completed", "attention"]).default("all"),
  search: z.string().trim().max(160).default(""),
  sort: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(DASHBOARD_PAGE_SIZE).default(DASHBOARD_PAGE_SIZE),
}).strict();

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type DashboardPagination = { page: number; limit: number; total: number };
