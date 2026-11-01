import {
  deliverySchema,
  inquirySchema,
  offerVersionSchema,
  ratePeriodSchema,
  roomSchema,
  type Delivery,
  type Inquiry,
  type OfferVersion,
  type RatePeriod,
  type Room,
} from "@hotel/contracts";

const timestamp = "2026-10-31T10:00:00Z";

export function room(overrides: Partial<Room> = {}): Room {
  return roomSchema.parse({
    id: "room-1",
    hotelId: "hotel-1",
    name: "Double Room",
    maxAdults: 2,
    maxChildren: 1,
    maxGuests: 3,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  });
}

export function rate(overrides: Partial<RatePeriod> = {}): RatePeriod {
  return ratePeriodSchema.parse({
    id: "rate-1",
    hotelId: "hotel-1",
    roomId: "room-1",
    planCode: "breakfast",
    planName: "Breakfast included",
    start: "2027-01-01",
    endExclusive: "2027-02-01",
    nightlyBaseCents: 10_000,
    currency: "EUR",
    mealPlan: "breakfast",
    includedAdults: 2,
    includedChildren: 0,
    extraAdultCents: 2_000,
    extraChildCents: 1_000,
    breakfastAdultCents: 0,
    breakfastChildCents: 0,
    maxChildAge: 11,
    minNights: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  });
}

export function inquiry(overrides: Partial<Inquiry> = {}): Inquiry {
  return inquirySchema.parse({
    id: "inquiry-1",
    hotelId: "hotel-1",
    guest: { name: "Anna", email: "anna@example.com" },
    checkIn: "2027-01-10",
    checkOut: "2027-01-12",
    occupancy: { adults: 2 },
    createdAt: timestamp,
    ...overrides,
  });
}

export function offer(overrides: Partial<OfferVersion> = {}): OfferVersion {
  return offerVersionSchema.parse({
    id: "offer-1",
    inquiryId: "inquiry-1",
    version: 1,
    publicTokenHash: "a".repeat(64),
    hotelSnapshot: { name: "Hotel Sole" },
    guestSnapshot: {
      name: "Anna",
      checkIn: "2027-01-10",
      checkOut: "2027-01-12",
      occupancy: { adults: 2 },
    },
    options: [
      {
        roomId: "room-1",
        roomName: "Double Room",
        planCode: "breakfast",
        planName: "Breakfast included",
        mealPlan: "breakfast",
        currency: "EUR",
        nights: [
          {
            date: "2027-01-10",
            ratePeriodId: "rate-1",
            baseCents: 10_000,
            extraAdultCents: 0,
            extraChildCents: 0,
            totalCents: 10_000,
          },
        ],
        totalCents: 10_000,
      },
    ],
    expiresAt: "2027-01-05T10:00:00Z",
    createdAt: timestamp,
    ...overrides,
  });
}

export function delivery(overrides: Partial<Delivery> = {}): Delivery {
  return deliverySchema.parse({
    id: "delivery-1",
    hotelId: "hotel-1",
    offerVersionId: "offer-1",
    channel: "email",
    purpose: "offer",
    recipient: "anna@example.com",
    status: "sent",
    sentAt: "2026-10-31T10:01:00Z",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  });
}
