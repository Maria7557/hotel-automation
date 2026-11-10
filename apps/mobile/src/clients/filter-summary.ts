import { locale as uiLocale, t, locale } from "../i18n";
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
  return new Intl.DateTimeFormat(uiLocale(), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export function clientFilterSummary(filters: ClientFilters, options: ClientFilterOptions): FilterSummary[] {
  const summary: FilterSummary[] = [];
  for (const [from, to, label] of [["stayFrom", "stayTo", t("Stay")], ["addedFrom", "addedTo", t("Added")]] as const) {
    if (filters[from] || filters[to]) summary.push({
      label: `${t(label)}: ${filters[from] ? dateLabel(filters[from]!) : t("any date")} – ${filters[to] ? dateLabel(filters[to]!) : t("onwards")}`,
      keys: [from, to],
    });
  }
  for (const [min, max, label] of [["minGuests", "maxGuests", t("Guests")], ["minAdults", "maxAdults", t("Adults")], ["minChildren", "maxChildren", t("Children")], ["minNights", "maxNights", t("Nights")]] as const) {
    if (filters[min] !== undefined || filters[max] !== undefined) summary.push({
      label: `${t(label)}: ${filters[min] === filters[max] ? filters[min] : filters[min] !== undefined && filters[max] !== undefined ? `${filters[min]}–${filters[max]}` : filters[min] !== undefined ? `${filters[min]}+` : t("up to {{v0}}", { v0: filters[max] ?? "" })}`,
      keys: [min, max],
    });
  }
  if (filters.roomId) summary.push({ label: t("Room: {{v0}}", { v0: options.rooms.find((room) => room.id === filters.roomId)?.name ?? "Selected room" }), keys: ["roomId"] });
  if (filters.mealPlan) summary.push({ label: t("Board: {{v0}}", { v0: filters.mealPlan }), keys: ["mealPlan"] });
  if (filters.status) summary.push({ label: t(statusOptions.find((option) => option.value === filters.status)!.label), keys: ["status"] });
  if (filters.source) summary.push({ label: filters.source === "manual" ? t("Added manually") : t("From enquiry"), keys: ["source"] });
  if (filters.locale) summary.push({ label: t("Language: {{v0}}", { v0: filters.locale }), keys: ["locale"] });
  if (filters.contact) summary.push({ label: filters.contact === "both" ? t("Has email & phone") : t("Has {{v0}}", { v0: t(filters.contact === "phone" ? "Phone" : "Email").toLowerCase() }), keys: ["contact"] });
  if (filters.reservations) summary.push({ label: filters.reservations === "with" ? t("With reservations") : t("No reservations"), keys: ["reservations"] });
  if (filters.notes) summary.push({ label: filters.notes === "with" ? t("Has notes") : t("No notes"), keys: ["notes"] });
  return summary;
}
