import { describe, expect, it } from "vitest";
import { contactUrl, formatOccupancy, formatPaymentLinkWait, formatStay, requestWait } from "../../mobile/src/requests/presentation.js";

describe("reservation summary formatting", () => {
  it("formats stays without timezone shifts, including month and year boundaries", () => {
    expect(formatStay("2026-11-01", "2026-11-03")).toBe("1 - 3 Nov");
    expect(formatStay("2026-11-30", "2026-12-02")).toBe("30 Nov - 2 Dec");
    expect(formatStay("2026-12-31", "2027-01-02")).toBe("31 Dec 2026 - 2 Jan 2027");
  });
  it("counts guests and nights from dates across daylight saving changes", () => {
    expect(formatOccupancy({ checkIn: "2026-10-24", checkOut: "2026-10-26", occupancy: { adults: 2, childAges: [5, 9] } })).toBe("2 nights · 4 people (2 adults, 2 children)");
    expect(formatOccupancy({ checkIn: "2026-11-01", checkOut: "2026-11-02", occupancy: { adults: 1, childAges: [] } })).toBe("1 night · 1 person (1 adult, 0 children)");
  });
  it("builds compose links from complete contacts and rejects invalid destinations", () => {
    expect(contactUrl("email", "guest+one@example.com")).toBe("mailto:guest%2Bone%40example.com");
    expect(contactUrl("whatsapp", "0039 (333) 123-4567")).toBe("https://wa.me/393331234567");
    expect(contactUrl("whatsapp", "3331234567")).toBeNull();
    expect(contactUrl("email", "guest@example.com\nBcc:other@example.com")).toBeNull();
    expect(contactUrl("email")).toBeNull();
  });
});

describe("waiting time on unfinished requests", () => {
  const timestamps = { receivedAt: "2026-11-09T10:00:00Z", offerSentAt: "2026-11-09T10:15:00Z", acceptedAt: "2026-11-09T10:30:00Z" };
  const now = Date.parse("2026-11-09T11:00:00Z");

  it.each([
    ["new", "1h 0m"],
    ["attention", "1h 0m"],
    ["payment", "30m"],
    ["waiting", "45m"],
  ] as const)("shows a live elapsed time for %s requests", (status, expected) => {
    const wait = requestWait({ ...timestamps, status });
    expect(wait).not.toBeNull();
    expect(formatPaymentLinkWait(wait!.since, now)).toBe(expected);
  });

  it("keeps the timer visible when an unfinished request is missing its later workflow timestamp", () => {
    for (const status of ["payment", "waiting"] as const) {
      for (const missing of [null, "invalid timestamp"]) {
        const wait = requestWait({ ...timestamps, status, acceptedAt: missing, offerSentAt: missing });
        expect(formatPaymentLinkWait(wait!.since, now)).toBe("1h 0m");
      }
    }
  });

  it("shows a time immediately for a newly received request", () => {
    const wait = requestWait({ status: "new", receivedAt: new Date(now).toISOString() });
    expect(formatPaymentLinkWait(wait!.since, now)).toBe("<1m");
  });

  it("stops showing an action timer once our work is complete", () => {
    expect(requestWait({ ...timestamps, status: "completed" })).toBeNull();
  });
});
