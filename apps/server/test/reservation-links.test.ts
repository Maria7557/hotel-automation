import { describe, expect, it } from "vitest";
import { detailHref, shouldOpenInApp } from "../../mobile/src/navigation/detail-href.js";

describe("reservation and client links", () => {
  it("uses stable, escaped detail URLs rather than today's request-list filters", () => {
    expect(detailHref("reservation", "historical-id")).toBe("#/reservations/historical-id");
    expect(detailHref("client", "client/id ?")).toBe("#/clients/client%2Fid%20%3F");
  });
  it("preserves browser open-in-new-tab gestures", () => {
    expect(shouldOpenInApp({ button: 0 })).toBe(true);
    expect(shouldOpenInApp({})).toBe(true);
    for (const event of [{ button: 1 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) {
      expect(shouldOpenInApp(event)).toBe(false);
    }
  });
});
