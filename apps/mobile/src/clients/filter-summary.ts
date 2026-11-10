import type { ClientFilters, ClientFilterOptions } from "../api/types";

export const statusOptions = [
  { value: "new", label: "New request" },
  { value: "waiting", label: "Waiting for reply" },
  { value: "payment", label: "Payment link needed" },
  { value: "completed", label: "Waiting for client" },
  { value: "attention", label: "Needs attention" },
];
export const boardOptions = [
  { value: "BB", label: "BB · Bed & breakfast" },
  { value: "HB", label: "HB · Half board" },
  { value: "FB", label: "FB · Full board" },
];
export type FilterSummary = { label: string; keys: Array<keyof ClientFilters> };

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export function clientFilterSummary(filters: ClientFilters, options: ClientFilterOptions): FilterSummary[] {
  const summary: FilterSummary[] = [];
  for (const [from, to, label] of [["stayFrom", "stayTo", "Stay"], ["addedFrom", "addedTo", "Added"]] as const) {
    if (filters[from] || filters[to]) summary.push({
      label: `${label}: ${filters[from] ? dateLabel(filters[from]!) : "any date"} – ${filters[to] ? dateLabel(filters[to]!) : "onwards"}`,
      keys: [from, to],
    });
  }
  for (const [min, max, label] of [["minGuests", "maxGuests", "Guests"], ["minAdults", "maxAdults", "Adults"], ["minChildren", "maxChildren", "Children"], ["minNights", "maxNights", "Nights"]] as const) {
    if (filters[min] !== undefined || filters[max] !== undefined) summary.push({
      label: `${label}: ${filters[min] === filters[max] ? filters[min] : filters[min] !== undefined && filters[max] !== undefined ? `${filters[min]}–${filters[max]}` : filters[min] !== undefined ? `${filters[min]}+` : `up to ${filters[max]}`}`,
      keys: [min, max],
    });
  }
  if (filters.roomId) summary.push({ label: `Room: ${options.rooms.find((room) => room.id === filters.roomId)?.name ?? "Selected room"}`, keys: ["roomId"] });
  if (filters.mealPlan) summary.push({ label: `Board: ${filters.mealPlan}`, keys: ["mealPlan"] });
  if (filters.status) summary.push({ label: statusOptions.find((option) => option.value === filters.status)!.label, keys: ["status"] });
  if (filters.source) summary.push({ label: filters.source === "manual" ? "Added manually" : "From enquiry", keys: ["source"] });
  if (filters.locale) summary.push({ label: `Language: ${filters.locale}`, keys: ["locale"] });
  if (filters.contact) summary.push({ label: filters.contact === "both" ? "Has email & phone" : `Has ${filters.contact}`, keys: ["contact"] });
  if (filters.reservations) summary.push({ label: filters.reservations === "with" ? "With reservations" : "No reservations", keys: ["reservations"] });
  if (filters.notes) summary.push({ label: filters.notes === "with" ? "Has notes" : "No notes", keys: ["notes"] });
  return summary;
}
