import type { Hotel, Inquiry, RatePeriod, Room } from "@hotel/contracts";

import type { HotelProfile, InquiryRecord, RatePeriodProfile, RoomProfile } from "../repositories/types.js";

export function toDomainHotel(hotel: HotelProfile): Hotel {
  return {
    id: hotel.id,
    ownerUserId: hotel.id,
    name: hotel.name,
    description: hotel.description ?? "",
    currency: hotel.currency,
    timezone: hotel.timezone,
    locale: hotel.locale,
    email: hotel.email,
    phone: hotel.phone,
    websiteUrl: hotel.website,
    logoUrl: hotel.logoUrl,
    photos: hotel.photoUrls.map((url, sortOrder) => ({ url, alt: hotel.name, sortOrder })),
    createdAt: hotel.createdAt.toISOString(),
    updatedAt: hotel.updatedAt.toISOString(),
  };
}

export function toDomainRoom(room: RoomProfile): Room {
  return {
    id: room.id,
    hotelId: room.hotelId,
    name: room.name,
    description: room.description ?? "",
    maxAdults: room.maxAdults,
    maxChildren: room.maxChildren,
    maxGuests: room.maxGuests,
    beds: room.beds,
    amenities: room.amenities,
    photos: room.photoUrls.map((url, sortOrder) => ({ url, alt: room.name, sortOrder })),
    active: room.active,
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
  };
}

export function toDomainRatePeriod(rate: RatePeriodProfile): RatePeriod {
  return {
    id: rate.id,
    hotelId: rate.hotelId,
    roomId: rate.roomId,
    planCode: rate.planCode,
    planName: rate.planName,
    mealPlan: rate.mealPlan,
    start: rate.start,
    endExclusive: rate.endExclusive,
    nightlyBaseCents: rate.nightlyBaseCents,
    currency: rate.currency,
    includedAdults: rate.includedAdults,
    includedChildren: rate.includedChildren,
    extraAdultCents: rate.extraAdultCents,
    extraChildCents: rate.extraChildCents,
    breakfastAdultCents: rate.breakfastAdultCents,
    breakfastChildCents: rate.breakfastChildCents,
    maxChildAge: rate.maxChildAge,
    minNights: rate.minNights,
    active: rate.active,
    createdAt: rate.createdAt.toISOString(),
    updatedAt: rate.updatedAt.toISOString(),
  };
}

export function toDomainInquiry(inquiry: InquiryRecord): Inquiry {
  return {
    id: inquiry.id,
    hotelId: inquiry.hotelId,
    externalKey: inquiry.idempotencyKey,
    guest: {
      name: inquiry.guestName,
      email: inquiry.guestEmail,
      phone: inquiry.guestPhone,
      language: inquiry.locale,
    },
    checkIn: inquiry.checkIn,
    checkOut: inquiry.checkOut,
    occupancy: inquiry.occupancy,
    note: inquiry.note,
    attentionReason: inquiry.attentionReason,
    createdAt: inquiry.createdAt.toISOString(),
  };
}
