import { locale as uiLocale } from "../i18n";
import type { ExtraChargeMode } from "@hotel/contracts";
export const extraChargeLabels: Record<ExtraChargeMode, string> = {
  per_stay: "Once per stay", per_night: "Per night", per_guest: "Per guest", per_guest_per_night: "Per guest, per night",
};
export function offerMoney(cents: number, currency = "EUR"): string {
  return new Intl.NumberFormat(uiLocale(), { style: "currency", currency }).format(cents / 100);
}
export function newOfferKey(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const value = Math.floor(Math.random() * 16);
    return (character === "x" ? value : (value & 3) | 8).toString(16);
  });
}
