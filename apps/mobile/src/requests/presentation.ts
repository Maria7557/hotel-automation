import type { HotelRequest } from "../api/types";

const dayMs = 86_400_000;
const dateParts = (value: string) => new Date(`${value}T00:00:00Z`);
const month = (date: Date) => new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(date);

export function formatStay(checkIn: string, checkOut: string): string {
  const start = dateParts(checkIn), end = dateParts(checkOut);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return "Dates unavailable";
  if (start.getUTCFullYear() !== end.getUTCFullYear()) return `${start.getUTCDate()} ${month(start)} ${start.getUTCFullYear()} - ${end.getUTCDate()} ${month(end)} ${end.getUTCFullYear()}`;
  if (start.getUTCMonth() !== end.getUTCMonth()) return `${start.getUTCDate()} ${month(start)} - ${end.getUTCDate()} ${month(end)}`;
  return `${start.getUTCDate()} - ${end.getUTCDate()} ${month(start)}`;
}

export function formatOccupancyParts(request: Pick<HotelRequest, "checkIn" | "checkOut" | "occupancy">) {
  const nights = Math.max(0, Math.round((dateParts(request.checkOut).getTime() - dateParts(request.checkIn).getTime()) / dayMs));
  const { adults, childAges } = request.occupancy;
  const people = adults + childAges.length;
  const nightsLabel = `${nights} ${nights === 1 ? "night" : "nights"}`;
  return {
    nights,
    people,
    summary: `${nightsLabel} · ${people} ${people === 1 ? "person" : "people"}`,
    breakdown: `(${adults} ${adults === 1 ? "adult" : "adults"}, ${childAges.length} ${childAges.length === 1 ? "child" : "children"})`,
  };
}

export function formatOccupancy(request: Pick<HotelRequest, "checkIn" | "checkOut" | "occupancy">): string {
  const { summary, breakdown } = formatOccupancyParts(request);
  return `${summary} ${breakdown}`;
}

export function contactUrl(channel: "email" | "whatsapp", recipient?: string): string | null {
  if (!recipient) return null;
  if (channel === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) ? `mailto:${encodeURIComponent(recipient)}` : null;
  const digits = recipient.replace(/[\s().-]/g, "").replace(/^00/, "+");
  return /^\+[1-9]\d{6,14}$/.test(digits) ? `https://wa.me/${digits.slice(1)}` : null;
}

export function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function formatPaymentLinkWait(acceptedAt: string, now = Date.now()): string | null {
  const accepted = Date.parse(acceptedAt);
  if (!Number.isFinite(accepted)) return null;
  const minutes = Math.max(0, Math.floor((now - accepted) / 60_000));
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
