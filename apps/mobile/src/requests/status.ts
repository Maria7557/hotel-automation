import { requestStatusAppearance } from "@hotel/design";
import type { HotelRequest, RequestStatus } from "../api/types";

export function requestAppearance(request: Pick<HotelRequest, "status" | "email" | "whatsapp">) {
  switch (request.status) {
    case "payment": return requestStatusAppearance.confirmation;
    case "completed": return requestStatusAppearance.ourWorkDone;
    case "waiting": return requestStatusAppearance.waitingForReply;
    case "new": return requestStatusAppearance.newRequest;
    case "attention": return request.email.status === "failed" || request.whatsapp.status === "failed"
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
