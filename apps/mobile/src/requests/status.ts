import { t } from "../i18n";
import { requestStatusAppearance } from "@hotel/design";
import { AUTOMATIC_SENDING_TIMEOUT_REASON } from "@hotel/contracts";
import type { DeliverySummary, HotelRequest, RequestStatus } from "../api/types";

export function deliverySendingLabel(delivery: DeliverySummary): string | null {
  if (delivery.state === "processing") return "Processing";
  if (delivery.state === "scheduled") {
    if (delivery.lastErrorCode?.endsWith("_CONNECTION_NOT_READY") || delivery.lastErrorCode?.endsWith("_CONFIG_REQUIRED")) return "Waiting for connection";
    if ((delivery.attemptCount ?? 0) > 0 || delivery.lastErrorCode) return "Awaiting automatic retry";
    return "Queued";
  }
  if (delivery.state === "unknown") return "Delivery unconfirmed";
  if (delivery.state === "cancelled") return "Sending cancelled";
  if (delivery.status === "failed") return "Sending failed";
  return delivery.status === "pending" ? "Sending pending" : null;
}

export function requestSendingDetails(request: Pick<HotelRequest, "status" | "email" | "whatsapp" | "attentionReason">) {
  if (request.attentionReason === AUTOMATIC_SENDING_TIMEOUT_REASON) return [{ channel: null, label: "Automatic sending did not complete within 15 minutes" }];
  if (request.status !== "new") return [];
  const details = (["email", "whatsapp"] as const).flatMap((channel) => {
    const label = deliverySendingLabel(request[channel]);
    return label ? [{ channel, label }] : [];
  });
  return details.length ? details : [{ channel: null, label: request.email.status === "unused" && request.whatsapp.status === "unused" ? "No delivery queued" : "Sending status unavailable" }];
}

export function requestAppearance(request: Pick<HotelRequest, "status" | "email" | "whatsapp" | "attentionReason">) {
  switch (request.status) {
    case "payment": return requestStatusAppearance.confirmation;
    case "completed": return requestStatusAppearance.ourWorkDone;
    case "waiting": return requestStatusAppearance.waitingForReply;
    case "new": return requestStatusAppearance.newRequest;
    case "attention": return request.attentionReason === AUTOMATIC_SENDING_TIMEOUT_REASON || request.email.status === "failed" || request.whatsapp.status === "failed"
      ? requestStatusAppearance.deliveryFailed
      : requestStatusAppearance.reviewNeeded;
  }
}

export const requestStatusLabels = {
  payment: "Payment link needed",
  completed: "Waiting for client",
  waiting: "Waiting for reply",
  new: "New request",
  attention: "Review needed",
} as const satisfies Record<RequestStatus, string>;

export function requestLabel(status: RequestStatus, failedDelivery = false): string {
  return status === "attention" && failedDelivery ? "Not delivered" : requestStatusLabels[status];
}

export const requestStatusDescriptions = {
  new: "Automatic sending is pending. These offers are expected to be processed automatically: queued, processing, waiting for a connection, or awaiting an automatic retry. Requests still unprocessed after 15 minutes move to errors.",
  attention: "Hotel action is needed. Automatic processing could not complete this request, or the offer needs review. Open the reservation and resolve the issue so processing can continue.",
  waiting: "The offer was sent. Waiting for the guest to reply or accept it.",
  payment: "The guest accepted the offer. Check availability and send a payment link, then mark it as sent.",
  completed: "The payment link was marked as sent. Our work is complete; waiting for the client to proceed. Payment is not confirmed here.",
} as const satisfies Record<RequestStatus, string>;

export function requestStatusHelp(request: Pick<HotelRequest, "status" | "email" | "whatsapp" | "attentionReason">): string {
  if (request.attentionReason === AUTOMATIC_SENDING_TIMEOUT_REASON) return t("Automatic sending was not confirmed within 15 minutes, so this request moved from NEW to errors. Check delivery details and channel connections. A queued retry or in-progress send may still finish; check before resending.");
  if (request.status === "new") {
    const details = requestSendingDetails(request);
    if (details.some(({ channel }) => channel === null)) {
      return t("This request is marked NEW, but no queued delivery can be confirmed from its data. Refresh or open the request to check. Automatic processing cannot be confirmed yet.");
    }
    if (details.some(({ label }) => label === "Sending failed" || label === "Delivery unconfirmed" || label === "Sending cancelled")) {
      return t("This request is marked NEW, but a delivery has failed, was cancelled, or has an unconfirmed outcome. Automatic processing cannot be assumed; open the request and check the delivery before resending.");
    }
    const stages = details.map(({ channel, label }) => `${channel === "email" ? "Email" : "WhatsApp"}: ${t(label)}.`).join(" ");
    const connection = details.some(({ label }) => label === "Waiting for connection")
      ? t(" Check the channel connection if it stays unavailable; sending resumes automatically when it is ready.")
      : "";
    return `${t(requestStatusDescriptions.new)} ${stages}${connection}`;
  }
  return t(requestStatusDescriptions[request.status]);
}
