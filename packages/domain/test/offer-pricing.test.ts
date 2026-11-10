import { describe, expect, it } from "vitest";
import { calculateOfferTotal } from "../src/index.js";
import type { OfferExtra } from "@hotel/contracts";

describe("offer extras pricing", () => {
  it("prices each charge mode by stay, nights, guests and guest-nights", () => {
    const modes = ["per_stay", "per_night", "per_guest", "per_guest_per_night"] as const;
    const extras: OfferExtra[] = modes.map((chargeMode, index) => ({ id: `extra-${index}`, name: chargeMode, description: "", unitPriceCents: 125, chargeMode, active: true, defaultSelected: false }));
    const result = calculateOfferTotal({ accommodationCents: 10000, nights: 3, guests: 4, extras, discountPercent: 0, depositPercent: 30 });
    expect(result.extras.map(({ quantity, totalCents }) => ({ quantity, totalCents }))).toEqual([
      { quantity: 1, totalCents: 125 }, { quantity: 3, totalCents: 375 }, { quantity: 4, totalCents: 500 }, { quantity: 12, totalCents: 1500 },
    ]);
    expect(result).toMatchObject({ totalCents: 12500, discountCents: 0, depositCents: 3750 });
  });
  it("rounds discounts and deposits in integer cents and handles a fully discounted stay", () => {
    const input = { accommodationCents: 10001, nights: 2, guests: 2, extras: [], discountPercent: 12.5, depositPercent: 30 };
    expect(calculateOfferTotal(input)).toMatchObject({ discountCents: 1250, totalCents: 8751, depositCents: 2625 });
    expect(calculateOfferTotal({ ...input, discountPercent: 100 })).toMatchObject({ totalCents: 0, depositCents: 0 });
  });
});
