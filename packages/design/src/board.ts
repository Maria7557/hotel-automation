// Board is a meal entitlement, independent of workflow/status colors.
export const boardAppearance = {
  BB: { segments: 1, fill: "#BDD2C3", track: "#96989A", background: "#F0F1F2", text: "#343A37", border: "#E0E2E4" },
  HB: { segments: 2, fill: "#5EDB95", track: "#96989A", background: "rgba(135, 220, 175, 0.25)", text: "#343A37", border: "#C1DCCE" },
  FB: { segments: 3, fill: "#12B55C", track: "#96989A", background: "rgba(135, 220, 175, 0.25)", text: "#000000", border: "#99DEB4" },
} as const;
