export type OfferPageState = "active" | "expired" | "accepted" | "revoked";

export type OfferSnapshot = Readonly<{
  inquiryId: string;
  hotelSnapshot: Readonly<{
    id?: string;
    name: string;
    description?: string;
    currency?: string;
    locale?: string;
    timezone?: string;
    logoUrl: string | null;
    photos?: readonly Readonly<{
      url: string;
      alt: string;
      sortOrder?: number;
    }>[];
  }>;
  guestSnapshot: Readonly<{
    name: string;
    checkIn: string;
    checkOut: string;
    occupancy: Readonly<{
      adults: number;
      childAges: readonly number[];
    }>;
  }>;
  options: readonly Readonly<{
    roomId: string;
    roomName: string;
    roomSnapshot?: Readonly<{
      description?: string;
      maxAdults?: number;
      maxChildren?: number;
      maxGuests?: number;
      beds?: readonly Readonly<{ type: string; count: number }>[];
      amenities?: readonly string[];
      photos?: readonly Readonly<{
        url: string;
        alt: string;
        sortOrder?: number;
      }>[];
    }>;
    planCode: string;
    planName: string;
    mealPlan: "room_only" | "breakfast";
    currency: string;
    nights: readonly Readonly<{
      date: string;
      ratePeriodId: string;
      baseCents: number;
      extraAdultCents: number;
      extraChildCents: number;
      totalCents: number;
    }>[];
    totalCents: number;
  }>[];
}>;

export type MessageRenderContext = Readonly<{
  publicOfferUrl: string;
  locale?: string;
}>;

export type PageRenderContext = Readonly<{
  state: OfferPageState;
  acceptActionPath: string;
  locale?: string;
  selectedOptionIndex?: number;
}>;
