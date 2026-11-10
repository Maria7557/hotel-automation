import { z } from "zod";

const dateFilter = z.iso.date().optional();
const countFilter = z.coerce.number().int().min(0).max(1000).optional();

export const clientFiltersSchema = z.object({
  stayFrom: dateFilter,
  stayTo: dateFilter,
  minGuests: countFilter,
  maxGuests: countFilter,
  minAdults: countFilter,
  maxAdults: countFilter,
  minChildren: countFilter,
  maxChildren: countFilter,
  minNights: countFilter,
  maxNights: countFilter,
  roomId: z.uuid().optional(),
  mealPlan: z.enum(["BB", "HB", "FB"]).optional(),
  status: z.enum(["new", "waiting", "payment", "completed", "attention"]).optional(),
  source: z.enum(["manual", "inquiry"]).optional(),
  locale: z.string().trim().min(2).max(16).optional(),
  contact: z.enum(["email", "phone", "both"]).optional(),
  reservations: z.enum(["with", "without"]).optional(),
  notes: z.enum(["with", "without"]).optional(),
  addedFrom: dateFilter,
  addedTo: dateFilter,
}).superRefine((filters, context) => {
  const ranges = [
    ["stayFrom", "stayTo", "Reservation period"],
    ["addedFrom", "addedTo", "Date added"],
    ["minGuests", "maxGuests", "Guests"],
    ["minAdults", "maxAdults", "Adults"],
    ["minChildren", "maxChildren", "Children"],
    ["minNights", "maxNights", "Nights"],
  ] as const;
  for (const [min, max, label] of ranges) {
    if (filters[min] !== undefined && filters[max] !== undefined && filters[min]! > filters[max]!) {
      context.addIssue({ code: "custom", path: [max], message: `${label}: the end must be at least the start.` });
    }
  }
  const hasStayFilter = [filters.stayFrom, filters.stayTo, filters.minGuests, filters.maxGuests,
    filters.minAdults, filters.maxAdults, filters.minChildren, filters.maxChildren,
    filters.minNights, filters.maxNights, filters.roomId, filters.mealPlan, filters.status].some((value) => value !== undefined);
  if (filters.reservations === "without" && hasStayFilter) {
    context.addIssue({ code: "custom", path: ["reservations"], message: "Choose clients with reservations to use reservation filters." });
  }
});

export type ClientFilters = z.infer<typeof clientFiltersSchema>;
export type ClientFilterOptions = {
  rooms: Array<{ id: string; name: string; archived: boolean }>;
  locales: string[];
};

export const clientListQuerySchema = clientFiltersSchema.safeExtend({
  search: z.string().trim().max(160).default(""),
  cursor: z.uuid().optional(),
});
