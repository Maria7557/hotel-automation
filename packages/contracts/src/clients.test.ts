import { describe, expect, it } from "vitest";
import { clientListQuerySchema } from "./clients.js";

describe("client filters", () => {
  it("parses zero counts and open or exact ranges", () => {
    expect(clientListQuerySchema.parse({ minChildren: "0", maxChildren: "0", minGuests: "2", maxGuests: "2", stayFrom: "2027-01-10", stayTo: "2027-01-10" }))
      .toMatchObject({ minChildren: 0, maxChildren: 0, minGuests: 2, maxGuests: 2 });
    expect(clientListQuerySchema.parse({ stayTo: "2027-01-10" })).toEqual({ search: "", stayTo: "2027-01-10" });
  });
  it("rejects invalid dates, bounds, rooms, statuses and contradictory filters", () => {
    for (const query of [
      { stayFrom: "2027-02-30" }, { stayFrom: "2027-02-01", stayTo: "2027-01-01" },
      { addedFrom: "2027-02-01", addedTo: "2027-01-01" }, { minGuests: "3", maxGuests: "2" },
      { minChildren: "-1" }, { maxAdults: "1.5" }, { minNights: "1001" }, { minGuests: "NaN" },
      { roomId: "not-a-room" }, { status: "paid" }, { reservations: "without", minChildren: "0" },
    ]) expect(clientListQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
  });
});
