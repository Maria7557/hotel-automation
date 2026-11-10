import { describe, expect, it } from "vitest";
import { requestAppearance, requestLabel } from "../../mobile/src/requests/status.js";

const channels = { email: { status: "sent" as const }, whatsapp: { status: "sent" as const } };

describe("responsibility-based reservation status groups", () => {
  it("keeps waiting for the client in the done group after our work is complete", () => {
    expect(requestAppearance({ ...channels, status: "completed" }).group).toBe("done");
    expect(requestLabel("completed")).toBe("Waiting for client");
  });
  it("separates an unanswered offer from the done group", () => {
    const awaitingReply = requestAppearance({ ...channels, status: "waiting" });
    const workDone = requestAppearance({ ...channels, status: "completed" });
    expect(awaitingReply.group).toBe("reply");
    expect(awaitingReply.color).not.toBe(workDone.color);
    expect(requestLabel("waiting")).toBe("Waiting for reply");
  });
  it("keeps a payment link we still need to send in our action group", () => {
    expect(requestAppearance({ ...channels, status: "payment" }).group).toBe("action");
    expect(requestLabel("payment")).toBe("Payment link needed");
  });
});
