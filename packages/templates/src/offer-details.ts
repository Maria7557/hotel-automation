import { copyFor, formatGuests, formatMoney, formatStay } from "./content.js";
import { escapeHtml } from "./security.js";
import type { OfferSnapshot } from "./types.js";

type Option = OfferSnapshot["options"][number];
export function snapshotForOption(snapshot: OfferSnapshot, option?: Option): OfferSnapshot {
  if (!option) return snapshot;
  return { ...snapshot, guestSnapshot: { ...snapshot.guestSnapshot,
    checkIn: option.checkIn ?? snapshot.guestSnapshot.checkIn, checkOut: option.checkOut ?? snapshot.guestSnapshot.checkOut,
    occupancy: option.occupancy ?? snapshot.guestSnapshot.occupancy, mealPlan: option.mealPlan } };
}
export function offerDetailsText(snapshot: OfferSnapshot, option: Option, locale?: string): string {
  const copy = copyFor(locale);
  const stay = snapshotForOption(snapshot, option);
  return [
    option.checkIn ? `${copy.stay}: ${formatStay(stay, locale)} · ${formatGuests(stay, locale)} · ${option.mealPlan}` : null,
    option.description || null,
    option.accommodationCents === undefined ? null : `${copy.accommodation}: ${formatMoney(option.accommodationCents, locale)}`,
    ...(option.extras ?? []).map((extra) => `${copy.extras} · ${extra.name}: ${extra.quantity} × ${formatMoney(extra.unitPriceCents, locale)} = ${formatMoney(extra.totalCents, locale)} (${copy.extraChargeModes[extra.chargeMode]})${extra.description ? ` · ${extra.description}` : ""}`),
    option.discountPercent ? `${copy.discount} (${option.discountPercent}%): −${formatMoney(option.discountCents ?? 0, locale)}` : null,
    option.depositPercent === undefined ? null : `${copy.deposit} (${option.depositPercent}%): ${formatMoney(option.depositCents ?? 0, locale)}`,
    option.cancellationPolicy ? `${copy.cancellationPolicy}: ${option.cancellationPolicy}` : null,
  ].filter((line): line is string => line !== null).join("\n");
}
export function renderOfferDetails(snapshot: OfferSnapshot, option: Option, locale?: string): string {
  const text = offerDetailsText(snapshot, option, locale);
  return text ? `<span class="offer-details">${text.split("\n").map((line) => `<span>${escapeHtml(line)}</span>`).join("")}</span>` : "";
}
