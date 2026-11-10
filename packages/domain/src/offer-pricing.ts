import type { OfferExtra, OfferExtraLine } from "@hotel/contracts";

export function calculateOfferTotal(input: {
  accommodationCents: number;
  nights: number;
  guests: number;
  extras: readonly OfferExtra[];
  discountPercent: number;
  depositPercent: number;
}) {
  const extras: OfferExtraLine[] = input.extras.map((extra) => {
    const quantity = (extra.chargeMode === "per_night" || extra.chargeMode === "per_guest_per_night" ? input.nights : 1)
      * (extra.chargeMode === "per_guest" || extra.chargeMode === "per_guest_per_night" ? input.guests : 1);
    return { id: extra.id, name: extra.name, description: extra.description, unitPriceCents: extra.unitPriceCents,
      chargeMode: extra.chargeMode, quantity, totalCents: extra.unitPriceCents * quantity };
  });
  const subtotalCents = input.accommodationCents + extras.reduce((sum, extra) => sum + extra.totalCents, 0);
  const discountCents = Math.round(subtotalCents * input.discountPercent / 100);
  const totalCents = subtotalCents - discountCents;
  if (![subtotalCents, totalCents].every(Number.isSafeInteger)) throw new Error("Offer price exceeds the supported range.");
  return { accommodationCents: input.accommodationCents, extras, discountPercent: input.discountPercent,
    discountCents, totalCents, depositPercent: input.depositPercent, depositCents: Math.round(totalCents * input.depositPercent / 100) };
}
