import { DEFAULT_GUEST_LANGUAGE, type ManualInquiryInput } from "@hotel/contracts";
import type { HotelRequest } from "../api/types";

type RequestDraft = Omit<ManualInquiryInput, "guest" | "mealPlan"> & {
  guest: Omit<ManualInquiryInput["guest"], "email" | "phone"> & { email: string | null; phone: string | null };
  mealPlan: HotelRequest["mealPlan"];
};

export function duplicateRequestDraft(request: HotelRequest): RequestDraft {
  const offers = request.offers?.map(({ roomId, planName, totalCents, note }) => ({ roomId, planName, totalCents, note }));
  return {
    guest: {
      name: request.guestName,
      email: request.email.recipient ?? null,
      phone: request.whatsapp.recipient ?? null,
      language: request.locale ?? DEFAULT_GUEST_LANGUAGE,
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
