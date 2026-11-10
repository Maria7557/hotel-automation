import { describe, expect, it } from "vitest";
import { deliverySendingLabel, requestAppearance, requestLabel, requestSendingDetails } from "../../mobile/src/requests/status.js";
import type { DeliverySummary } from "../../mobile/src/api/types.js";
import { AUTOMATIC_SENDING_TIMEOUT_REASON } from "@hotel/contracts";

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

describe("pending offer sending details", () => {
  it("shows overdue pending deliveries as an error with a visible timeout explanation", () => {
    const request = { status: "attention" as const, attentionReason: AUTOMATIC_SENDING_TIMEOUT_REASON,
      email: { status: "pending" as const, state: "scheduled" as const }, whatsapp: { status: "unused" as const } };
    expect(requestAppearance(request)).toBe(requestAppearance({ ...request, email: { status: "failed" } }));
    expect(requestSendingDetails(request)).toEqual([{ channel: null, label: "Automatic sending did not complete within 15 minutes" }]);
  });
  it.each<{ delivery: DeliverySummary; label: string }>([
    { delivery: { status: "pending", state: "scheduled", attemptCount: 0 }, label: "Queued" },
    { delivery: { status: "pending", state: "processing", attemptCount: 2, lastErrorCode: "EMAIL_CONNECTION_NOT_READY" }, label: "Processing" },
    { delivery: { status: "pending", state: "scheduled", attemptCount: 0, lastErrorCode: "EMAIL_CONNECTION_NOT_READY" }, label: "Waiting for connection" },
    { delivery: { status: "pending", state: "scheduled", attemptCount: 2, lastErrorCode: "WHATSAPP_CONNECTION_NOT_READY" }, label: "Waiting for connection" },
    { delivery: { status: "pending", state: "scheduled", attemptCount: 0, lastErrorCode: "GOOGLE_CONFIG_REQUIRED" }, label: "Waiting for connection" },
    { delivery: { status: "pending", state: "scheduled", attemptCount: 1, lastErrorCode: "MICROSOFT_CONFIG_REQUIRED" }, label: "Waiting for connection" },
    { delivery: { status: "pending", state: "scheduled", attemptCount: 2, lastErrorCode: "WAHA_SEND_HTTP_429" }, label: "Awaiting automatic retry" },
    { delivery: { status: "pending", state: "scheduled", lastErrorCode: "SMTP_UNAVAILABLE" }, label: "Awaiting automatic retry" },
    { delivery: { status: "failed", state: "failed" }, label: "Sending failed" },
    { delivery: { status: "failed", state: "unknown" }, label: "Delivery unconfirmed" },
    { delivery: { status: "unused", state: "cancelled" }, label: "Sending cancelled" },
    { delivery: { status: "pending" }, label: "Sending pending" },
  ])("shows $label from delivery metadata", ({ delivery, label }) => {
    expect(deliverySendingLabel(delivery)).toBe(label);
  });

  it("shows different sending stages for each channel without expanding a new request", () => {
    expect(requestSendingDetails({ status: "new", email: { status: "pending", state: "processing" }, whatsapp: { status: "pending", state: "scheduled", attemptCount: 1 } })).toEqual([
      { channel: "email", label: "Processing" },
      { channel: "whatsapp", label: "Awaiting automatic retry" },
    ]);
  });

  it("does not invent a queued delivery when none exists or sending already succeeded", () => {
    expect(requestSendingDetails({ status: "new", email: { status: "unused" }, whatsapp: { status: "unused" } })).toEqual([{ channel: null, label: "No delivery queued" }]);
    expect(requestSendingDetails({ status: "new", ...channels })).toEqual([{ channel: null, label: "Sending status unavailable" }]);
    expect(requestSendingDetails({ status: "waiting", ...channels })).toEqual([]);
  });
});
