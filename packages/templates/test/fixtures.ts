import type { OfferSnapshot } from "../src/index.js";

export function offerSnapshot(): OfferSnapshot {
  return {
    inquiryId: "inquiry-1",
    hotelSnapshot: {
      id: "hotel-1",
      name: "Hotel Sole",
      description: "Ospitalità nel cuore di Roma.",
      currency: "EUR",
      locale: "it-IT",
      timezone: "Europe/Rome",
      logoUrl: "https://cdn.example.com/logo.png",
      photos: [],
    },
    guestSnapshot: {
      name: "Anna",
      checkIn: "2027-01-10",
      checkOut: "2027-01-12",
      occupancy: { adults: 2, childAges: [8] },
    },
    options: [
      {
        roomId: "double",
        roomName: "Camera Doppia",
        roomSnapshot: {
          description: "Camera luminosa con vista sul cortile.",
          maxAdults: 2,
          maxChildren: 1,
          maxGuests: 3,
          beds: [{ type: "queen", count: 1 }],
          amenities: ["Wi-Fi", "Aria condizionata"],
          photos: [
            {
              url: "https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=1200&q=85",
              alt: "Camera Doppia — camera da letto",
              sortOrder: 0,
            },
            {
              url: "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1200&q=85",
              alt: "Camera Doppia — area soggiorno",
              sortOrder: 1,
            },
            {
              url: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1200&q=85",
              alt: "Camera Doppia — dettaglio",
              sortOrder: 2,
            },
            {
              url: "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=1200&q=85",
              alt: "Camera Doppia — bagno",
              sortOrder: 3,
            },
            {
              url: "https://images.unsplash.com/photo-1564501049412-61c2a3083791?auto=format&fit=crop&w=1200&q=85",
              alt: "Camera Doppia — vista",
              sortOrder: 4,
            },
          ],
        },
        planCode: "breakfast",
        planName: "Tariffa flessibile",
        mealPlan: "breakfast",
        currency: "EUR",
        nights: [
          {
            date: "2027-01-10",
            ratePeriodId: "rate-1",
            baseCents: 10_000,
            extraAdultCents: 0,
            extraChildCents: 1_000,
            totalCents: 11_000,
          },
          {
            date: "2027-01-11",
            ratePeriodId: "rate-1",
            baseCents: 10_000,
            extraAdultCents: 0,
            extraChildCents: 1_000,
            totalCents: 11_000,
          },
        ],
        totalCents: 22_000,
      },
      {
        roomId: "suite",
        roomName: "Junior Suite",
        roomSnapshot: {
          description: "Più spazio per il soggiorno.",
          maxAdults: 3,
          maxChildren: 1,
          maxGuests: 4,
          beds: [
            { type: "king", count: 1 },
            { type: "sofa bed", count: 1 },
          ],
          amenities: ["Wi-Fi", "Minibar", "Balcone"],
          photos: [
            {
              url: "https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=1200&q=85",
              alt: "Junior Suite — camera da letto",
              sortOrder: 0,
            },
            {
              url: "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?auto=format&fit=crop&w=1200&q=85",
              alt: "Junior Suite — area soggiorno",
              sortOrder: 1,
            },
            {
              url: "https://images.unsplash.com/photo-1591088398332-8a7791972843?auto=format&fit=crop&w=1200&q=85",
              alt: "Junior Suite — dettaglio",
              sortOrder: 2,
            },
            {
              url: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1200&q=85",
              alt: "Junior Suite — vista",
              sortOrder: 3,
            },
          ],
        },
        planCode: "room-only",
        planName: "Solo pernottamento",
        mealPlan: "room_only",
        currency: "EUR",
        nights: [
          {
            date: "2027-01-10",
            ratePeriodId: "rate-2",
            baseCents: 14_000,
            extraAdultCents: 0,
            extraChildCents: 0,
            totalCents: 14_000,
          },
          {
            date: "2027-01-11",
            ratePeriodId: "rate-2",
            baseCents: 14_000,
            extraAdultCents: 0,
            extraChildCents: 0,
            totalCents: 14_000,
          },
        ],
        totalCents: 28_000,
      },
    ],
  };
}
