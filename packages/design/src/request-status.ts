export type StatusColors = { color: string; backgroundColor: string; textColor?: string };

type StatusAppearance = StatusColors & { group: "action" | "done" | "reply" };

// Green means our work is complete, including waiting for the client to proceed.
// Orange marks pending sending; yellow marks an offer awaiting the client’s reply.
export const requestStatusAppearance = {
  confirmation: { group: "action", color: "#7040B4", backgroundColor: "#F1EAF9" },
  deliveryFailed: { group: "action", color: "#B42332", backgroundColor: "#FDEBED" },
  reviewNeeded: { group: "action", color: "#A82363", backgroundColor: "#FCE8F1" },
  newRequest: { group: "action", color: "#D97706", backgroundColor: "#FFFFFF", textColor: "#4A4A4A" },
  ourWorkDone: { group: "done", color: "#217A55", backgroundColor: "#E5F6EE" },
  waitingForReply: { group: "reply", color: "#FFB000", backgroundColor: "#FFF3CC", textColor: "#202020" },
} as const satisfies Record<string, StatusAppearance>;
