import type { Delivery, Inquiry, OfferVersion } from "@hotel/contracts";

export type InquiryState =
  | "new"
  | "offer_sent"
  | "requires_confirmation"
  | "needs_attention";

export function deriveInquiryState(input: {
  inquiry: Inquiry;
  offers: readonly OfferVersion[];
  deliveries: readonly Delivery[];
  now?: string;
}): InquiryState {
  const latest = [...input.offers]
    .filter((offer) => offer.inquiryId === input.inquiry.id)
    .sort((left, right) => right.version - left.version)[0];

  if (!latest) {
    return input.inquiry.attentionReason === null ? "new" : "needs_attention";
  }
  if (latest.acceptedAt !== null) return "requires_confirmation";
  if (input.inquiry.attentionReason !== null) return "needs_attention";
  if (latest.revokedAt !== null) return "needs_attention";

  const now = input.now ?? new Date().toISOString();
  if (latest.expiresAt <= now) return "needs_attention";

  const wasSent = input.deliveries.some(
    (delivery) =>
      delivery.offerVersionId === latest.id &&
      delivery.purpose === "offer" &&
      delivery.status === "sent",
  );
  return wasSent ? "offer_sent" : "new";
}
