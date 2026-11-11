import { describe, expect, it } from "vitest";
import { hasDuplicateOfferChoices, nextOfferAlternative } from "../../mobile/src/requests/offer-alternatives.js";

const stay = { checkIn: "2027-02-01", checkOut: "2027-02-03" };
const bb = { roomId: "room", planCode: "standard", mealPlan: "BB" } as const;
const hb = { ...bb, mealPlan: "HB" } as const;
const existing = [{ ...bb, ...stay }];

describe("mobile offer alternatives", () => {
  it("uses catalog boards beyond the original request suggestions", () => {
    expect(nextOfferAlternative({ suggestions: [bb], plans: [bb, hb] }, existing, stay)).toEqual(hb);
  });
  it("uses catalog plans when original dates or board have no priced suggestions", () => {
    expect(nextOfferAlternative({ suggestions: [], plans: [bb, hb] }, [], stay)).toEqual(bb);
  });
  it("does not silently duplicate when the catalog is exhausted", () => {
    expect(nextOfferAlternative({ suggestions: [bb], plans: [bb] }, existing, stay)).toBeUndefined();
  });
  it("rejects drafts edited to the same combination", () => {
    expect(hasDuplicateOfferChoices([...existing, { ...existing[0]! }])).toBe(true);
  });
  it("allows distinct board, rate and stay alternatives", () => {
    expect(hasDuplicateOfferChoices([...existing, { ...hb, ...stay }, { ...bb, ...stay, planCode: "flex" },
      { ...bb, ...stay, checkOut: "2027-02-04" }])).toBe(false);
    expect(nextOfferAlternative({ suggestions: [bb], plans: [bb] }, existing, { ...stay, checkOut: "2027-02-04" })).toEqual(bb);
  });
  it("does not treat incomplete alternatives as selected duplicate offers", () => {
    expect(hasDuplicateOfferChoices([{ ...bb, ...stay, roomId: "" }, { ...bb, ...stay, roomId: "" }])).toBe(false);
  });
});
