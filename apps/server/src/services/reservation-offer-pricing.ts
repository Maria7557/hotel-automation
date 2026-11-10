import type { OfferSettings, SendReservationOffersInput } from "@hotel/contracts";
import { buildOfferDraft, calculateOfferTotal, roomFitsOccupancy } from "@hotel/domain";
import { toDomainHotel, toDomainInquiry, toDomainRatePeriod, toDomainRoom } from "../adapters/domain.js";
import { errors } from "../lib/errors.js";
import type { AutomationRepository, HotelProfile, InquiryRecord } from "../repositories/types.js";

export function quoteReservationOffer(
  hotel: HotelProfile,
  inquiry: Omit<InquiryRecord, "reservationNumber">,
  choice: SendReservationOffersInput["offers"][number],
  catalog: Awaited<ReturnType<AutomationRepository["listCatalogForHotel"]>>,
  settings: OfferSettings,
) {
  const room = catalog.rooms.find(({ id }) => id === choice.roomId);
  if (!room) throw errors.roomNotFound();
  const stay = { ...inquiry, checkIn: choice.checkIn ?? inquiry.checkIn, checkOut: choice.checkOut ?? inquiry.checkOut,
    occupancy: choice.occupancy ?? inquiry.occupancy, mealPlan: choice.mealPlan ?? inquiry.mealPlan };
  if (!stay.mealPlan) throw errors.offerBoardRequired();
  const nightsCount = (Date.parse(stay.checkOut) - Date.parse(stay.checkIn)) / 86_400_000;
  if (!(nightsCount > 0 && nightsCount <= 730)) throw errors.offerRateUnavailable();
  const domainRoom = toDomainRoom(room);
  if (!roomFitsOccupancy(domainRoom, stay.occupancy)) throw errors.roomCapacityExceeded();
  const manual = choice.pricingMode !== "automatic" && !choice.planCode && choice.totalCents !== undefined;
  const result = manual ? null : buildOfferDraft({
    hotel: toDomainHotel(hotel), inquiry: toDomainInquiry(stay), rooms: [domainRoom],
    ratePeriods: catalog.ratePeriods.filter((rate) => !choice.planCode || rate.planCode === choice.planCode).map(toDomainRatePeriod),
  });
  const calculated = result?.ok ? result.draft.options[0] : null;
  if (!manual && !calculated) throw errors.offerRateUnavailable(result && !result.ok ? result.issues : undefined);
  const selectedIds = choice.extraIds ?? settings.extras.filter((extra) => extra.active && extra.defaultSelected).map(({ id }) => id);
  const extras = selectedIds.map((id) => {
    const extra = settings.extras.find((item) => item.id === id && item.active);
    if (!extra) throw errors.offerExtraUnavailable();
    return extra;
  });
  const pricing = calculateOfferTotal({ accommodationCents: calculated?.totalCents ?? choice.totalCents!,
    nights: nightsCount, guests: stay.occupancy.adults + stay.occupancy.childAges.length, extras,
    discountPercent: choice.discountPercent ?? 0, depositPercent: choice.depositPercent ?? settings.defaultDepositPercent });
  if (choice.quotedTotalCents !== undefined && pricing.totalCents !== choice.quotedTotalCents) throw errors.offerPriceChanged();
  return {
    roomId: room.id, roomName: room.name,
    roomSnapshot: { description: domainRoom.description, maxAdults: room.maxAdults, maxChildren: room.maxChildren,
      maxGuests: room.maxGuests, beds: room.beds, amenities: room.amenities, photos: domainRoom.photos },
    planCode: calculated?.planCode ?? "personal", planName: choice.planName ?? calculated?.planName ?? "Personal offer",
    mealPlan: stay.mealPlan, checkIn: stay.checkIn, checkOut: stay.checkOut, occupancy: stay.occupancy,
    currency: hotel.currency, description: choice.description ?? "", note: choice.note,
    pricingSource: calculated ? "rates" as const : "staff" as const, nights: calculated?.nights ?? [],
    cancellationPolicy: choice.cancellationPolicy ?? (settings.cancellationPolicy || hotel.termsText || ""),
    ...pricing,
  };
}
