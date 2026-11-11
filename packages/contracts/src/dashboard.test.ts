import { describe, expect, it } from "vitest";
import { dashboardIncludesRequest, dashboardQuerySchema } from "./dashboard.js";

describe("dashboard date scopes", () => {
  it("defaults incoming to today and rejects unknown scopes", () => {
    expect(dashboardQuerySchema.parse({}).scope).toBe("today");
    expect(dashboardQuerySchema.safeParse({ scope: "all" }).success).toBe(false);
  });
  it("keeps ordinary incoming daily but searches every date", () => {
    const daily = dashboardQuerySchema.parse({});
    for (const status of ["new", "waiting", "payment", "completed", "attention"]) {
      expect(dashboardIncludesRequest(daily, status, true)).toBe(true);
      expect(dashboardIncludesRequest(daily, status, false)).toBe(false);
      expect(dashboardIncludesRequest({ ...daily, search: "#42" }, status, false)).toBe(true);
    }
  });
  it("keeps all outstanding actions across dates and excludes completed/waiting requests", () => {
    for (const search of ["", "#42"]) {
      const actions = dashboardQuerySchema.parse({ scope: "actions", search });
      for (const today of [true, false]) {
        for (const status of ["new", "payment", "attention"]) expect(dashboardIncludesRequest(actions, status, today)).toBe(true);
        for (const status of ["waiting", "completed"]) expect(dashboardIncludesRequest(actions, status, today)).toBe(false);
      }
    }
  });
});
