import { hotelSchema, inquirySchema, offerSettingsSchema, ratePeriodSchema, roomSchema, type OfferEditorData, type OfferQuote, type OfferSettings, type SendReservationOffersInput } from "@hotel/contracts";
import { buildOfferDraft, calculateOfferTotal } from "@hotel/domain";
import type { HotelRequest } from "./types";

let settings: OfferSettings = offerSettingsSchema.parse({ extras: [
  { id: "10000000-0000-4000-8000-000000000001", name: "Covered parking", description: "A reserved space for your stay", unitPriceCents: 1400, chargeMode: "per_night" },
  { id: "10000000-0000-4000-8000-000000000002", name: "Station transfer", description: "Return transfer to the train station", unitPriceCents: 2500, chargeMode: "per_stay" },
], cancellationPolicy: "Free cancellation up to 7 days before arrival. Later cancellations are charged the deposit." });
const timestamp = "2026-01-01T00:00:00Z";
const hotel = hotelSchema.parse({ id: "demo", ownerUserId: "demo", name: "Casa Aurelia", currency: "EUR", createdAt: timestamp, updatedAt: timestamp });
const rooms = ["Deluxe Room", "Junior Suite", "Family Room"].map((name, index) => roomSchema.parse({
  id: `00000000-0000-4000-8000-00000000000${index + 1}`, hotelId: hotel.id, name,
  maxAdults: 4, maxChildren: 3, maxGuests: 6, createdAt: timestamp, updatedAt: timestamp,
}));
const rates = rooms.flatMap((room, index) => (["BB", "HB", "FB"] as const).map((mealPlan, boardIndex) => ratePeriodSchema.parse({
  id: `${room.id}:${mealPlan}`, hotelId: hotel.id, roomId: room.id, planCode: "standard", planName: "Flexible rate",
  mealPlan, start: "2026-01-01", endExclusive: "2032-01-01", nightlyBaseCents: [14000, 19000, 18000][index]! + boardIndex * 2000,
  includedAdults: 2, includedChildren: 0, extraAdultCents: 4000, extraChildCents: 1500,
  createdAt: timestamp, updatedAt: timestamp,
})));

export function getDemoOfferSettings(): OfferSettings { return structuredClone(settings); }
export function saveDemoOfferSettings(value: OfferSettings): OfferSettings {
  settings = offerSettingsSchema.parse(value);
  return getDemoOfferSettings();
}
type RequestStay = Pick<HotelRequest, "id" | "guestName" | "checkIn" | "checkOut" | "occupancy" | "mealPlan">;
function draftFor(request: RequestStay, choice?: SendReservationOffersInput["offers"][number]) {
  return buildOfferDraft({ hotel, rooms: choice ? rooms.filter(({ id }) => id === choice.roomId) : rooms, ratePeriods: rates,
    inquiry: inquirySchema.parse({ id: request.id, hotelId: hotel.id, guest: { name: request.guestName, email: "guest@example.com" },
      checkIn: choice?.checkIn ?? request.checkIn, checkOut: choice?.checkOut ?? request.checkOut,
      occupancy: choice?.occupancy ?? request.occupancy, mealPlan: choice?.mealPlan ?? request.mealPlan, createdAt: timestamp }) });
}
export function quoteDemoOffer(request: RequestStay, choice: SendReservationOffersInput["offers"][number]): OfferQuote {
  const result = draftFor(request, choice);
  const option = result.ok ? result.draft.options.find((item) => !choice.planCode || item.planCode === choice.planCode) : null;
  if (!option) throw new Error("No matching rate. Check the room, dates, guests and board.");
  const checkIn = choice.checkIn ?? request.checkIn;
  const checkOut = choice.checkOut ?? request.checkOut;
  const occupancy = choice.occupancy ?? request.occupancy;
  const extraIds = choice.extraIds ?? settings.extras.filter((extra) => extra.active && extra.defaultSelected).map(({ id }) => id);
  const extras = extraIds.map((id) => {
    const extra = settings.extras.find((extra) => extra.id === id && extra.active);
    if (!extra) throw new Error("A selected extra is no longer available.");
    return extra;
  });
  const pricing = calculateOfferTotal({ accommodationCents: option.totalCents, nights: (Date.parse(checkOut) - Date.parse(checkIn)) / 86400000,
    guests: occupancy.adults + occupancy.childAges.length, extras, discountPercent: choice.discountPercent ?? 0, depositPercent: choice.depositPercent ?? settings.defaultDepositPercent });
  return { roomId: option.roomId, roomName: option.roomName, planCode: option.planCode, planName: choice.planName ?? option.planName,
    checkIn, checkOut, occupancy, mealPlan: option.mealPlan, currency: "EUR", description: choice.description ?? "", note: choice.note,
    pricingSource: "rates", cancellationPolicy: choice.cancellationPolicy ?? settings.cancellationPolicy, ...pricing };
}
export function demoOfferEditor(request: RequestStay): OfferEditorData {
  const result = draftFor(request);
  return { settings: getDemoOfferSettings(), rooms, plans: rates.map(({ roomId, planCode, planName, mealPlan }) => ({ roomId, planCode, planName, mealPlan })),
    suggestions: result.ok ? result.draft.options.map(({ roomId, planCode }) => quoteDemoOffer(request, { roomId, planCode, note: "" })) : [] };
}
export function prefillDemoOffers(request: HotelRequest): HotelRequest {
  if (request.offers !== undefined || request.totalCents <= 0 || request.attentionReason === "manual_review") return request;
  const room = rooms.find(({ name }) => name === request.roomLabel) ?? rooms[0]!;
  const offerId = `00000000-0000-4000-9000-${request.reservationNumber.padStart(12, "0")}`;
  const expiresAt = request.offerExpiresAt ?? new Date(Date.now() + 7 * 86400000).toISOString();
  request.currentOfferId = offerId;
  request.offers = [{ id: `${offerId}:0`, roomId: room.id, roomName: room.name, planCode: "standard", planName: "Flexible rate",
    checkIn: request.checkIn, checkOut: request.checkOut, occupancy: request.occupancy, mealPlan: request.mealPlan, currency: "EUR",
    accommodationCents: request.totalCents, totalCents: request.totalCents, extras: [], discountPercent: 0, discountCents: 0,
    depositPercent: 30, depositCents: Math.round(request.totalCents * 0.3), cancellationPolicy: settings.cancellationPolicy,
    note: "", description: "", pricingSource: "rates", expiresAt, status: request.acceptedAt || request.status === "payment" || request.status === "completed" ? "accepted" : "available" }];
  return request;
}
