import type { ManualInquiryInput } from "@hotel/contracts";
import type { HotelRequest } from "../api/types";

export function duplicateRequestDraft(request: HotelRequest, locale: string): Omit<ManualInquiryInput, "mealPlan"> & { mealPlan: HotelRequest["mealPlan"] } {
  const offers = request.offers?.map(({ roomId, planName, totalCents, note }) => ({ roomId, planName, totalCents, note }));
  return {
    guest: {
      name: request.guestName,
      email: request.email.recipient ?? null,
      phone: request.whatsapp.recipient ?? null,
      language: request.locale ?? locale,
    },
    checkIn: request.checkIn,
    checkOut: request.checkOut,
    occupancy: { adults: request.occupancy.adults, childAges: [...request.occupancy.childAges] },
    mealPlan: request.mealPlan,
    receivedVia: request.receivedVia ?? "other",
    note: request.note ?? "",
    sendOffer: false,
    ...(offers?.length ? { offers } : {}),
  };
}
