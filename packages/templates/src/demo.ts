import { renderPublicOfferPage } from "./page.js";
import type { OfferSnapshot } from "./types.js";

export const DEMO_OFFER_PATH = "/proposal/preview";

export const demoOfferSnapshot: OfferSnapshot = {
  inquiryId: "demo-preview",
  hotelSnapshot: { name: "Casa Aurelia", currency: "EUR", locale: "it", logoUrl: null },
  guestSnapshot: {
    name: "Mario Rossi", language: "it", checkIn: "2027-06-10", checkOut: "2027-06-12",
    occupancy: { adults: 2, childAges: [] }, mealPlan: "BB",
  },
  options: [
    {
      roomId: "demo-deluxe", roomName: "Deluxe Room", planCode: "flexible", planName: "Tariffa flessibile",
      mealPlan: "BB", currency: "EUR", totalCents: 24_000,
      roomSnapshot: {
        description: "Camera luminosa con letto matrimoniale e area relax.",
        maxAdults: 2, maxChildren: 0, maxGuests: 2, beds: [{ type: "king", count: 1 }],
        amenities: ["Wi-Fi", "Aria condizionata"],
        photos: [{ url: "https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=1200&q=85", alt: "Deluxe Room" }],
      },
      nights: ["2027-06-10", "2027-06-11"].map((date) => ({
        date, ratePeriodId: "demo-deluxe-rate", baseCents: 12_000, extraAdultCents: 0, extraChildCents: 0, totalCents: 12_000,
      })),
    },
    {
      roomId: "demo-suite", roomName: "Junior Suite", planCode: "flexible", planName: "Tariffa flessibile",
      mealPlan: "BB", currency: "EUR", totalCents: 32_000,
      roomSnapshot: {
        description: "Suite spaziosa con zona soggiorno e balcone.",
        maxAdults: 3, maxChildren: 1, maxGuests: 4, beds: [{ type: "king", count: 1 }, { type: "sofa bed", count: 1 }],
        amenities: ["Wi-Fi", "Minibar", "Balcone"],
        photos: [{ url: "https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=1200&q=85", alt: "Junior Suite" }],
      },
      nights: ["2027-06-10", "2027-06-11"].map((date) => ({
        date, ratePeriodId: "demo-suite-rate", baseCents: 16_000, extraAdultCents: 0, extraChildCents: 0, totalCents: 16_000,
      })),
    },
  ],
};

export function renderDemoOfferPage(accepted = false, selectedOptionIndex = 0, language: "en" | "it" = "it"): string {
  const snapshot: OfferSnapshot = language === "it" ? demoOfferSnapshot : { ...demoOfferSnapshot, guestSnapshot: { ...demoOfferSnapshot.guestSnapshot, language }, options: demoOfferSnapshot.options.map((option, index) => ({ ...option, planName: "Flexible rate", roomSnapshot: { ...option.roomSnapshot, description: index === 0 ? "Bright room with a double bed and seating area." : "Spacious suite with a living area and balcony.", amenities: index === 0 ? ["Wi-Fi", "Air conditioning"] : ["Wi-Fi", "Minibar", "Balcony"] } })) };
  return renderPublicOfferPage(snapshot, {
    locale: language,
    state: accepted ? "accepted" : "active", selectedOptionIndex,
    acceptActionPath: `${DEMO_OFFER_PATH}/accept`, testMode: true,
  });
}
