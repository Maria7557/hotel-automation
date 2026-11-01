import type { DashboardSnapshot, HotelProfile, HotelRequest } from "./types";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

export const mockProfile: HotelProfile = {
  name: "Casa Aurelia",
  city: "Florence, Italy",
  countryCode: "IT",
  email: "booking@casaaurelia.it",
  currency: "EUR",
  locale: "en-GB",
  timezone: "Europe/Rome",
  description: "A small independent hotel in the heart of Florence.",
  phone: "+39 055 000 0000",
  website: "https://example.com",
  logoUrl: "",
  photoUrls: [],
  termsText: "Availability is confirmed by the hotel after the offer is accepted.",
  publicKey: "11111111-1111-4111-8111-111111111111",
  allowedOrigins: ["https://hotel.example.com"],
};

const primaryRequests: HotelRequest[] = [
    {
      id: "req_1008",
      guestName: "Anna Rossi",
      stayLabel: "12–16 November · 4 nights",
      guestLabel: "2 adults · 1 child",
      roomLabel: "Deluxe Room",
      totalLabel: "€ 640",
      totalCents: 64_000,
      currency: "EUR",
      receivedAt: minutesAgo(3),
      status: "payment",
      statusLabel: "To confirm",
      nextAction: "Review availability",
      email: { status: "sent", recipient: "anna@example.com", processedAt: "2026-10-31T12:11:00.000Z" },
      whatsapp: { status: "sent", recipient: "+393331234567", processedAt: "2026-10-31T12:11:10.000Z" },
    },
    {
      id: "req_1007",
      guestName: "Luca Bianchi",
      stayLabel: "20–23 November · 3 nights",
      guestLabel: "2 adults",
      roomLabel: "Junior Suite",
      totalLabel: "€ 570",
      totalCents: 57_000,
      currency: "EUR",
      receivedAt: minutesAgo(5),
      status: "attention",
      statusLabel: "Not delivered",
      nextAction: "Retry WhatsApp",
      attentionReason: "WHATSAPP_DELIVERY_FAILED",
      email: { status: "sent", recipient: "luca@example.com", processedAt: "2026-10-31T11:43:00.000Z" },
      whatsapp: { status: "failed", recipient: "+393339876543", lastErrorCode: "WAHA_SESSION_NOT_WORKING", processedAt: null },
    },
    {
      id: "req_1006",
      guestName: "Sofia Müller",
      stayLabel: "2–7 December · 5 nights",
      guestLabel: "2 adults · 2 children",
      roomLabel: "Family Room",
      totalLabel: "€ 1.050",
      totalCents: 105_000,
      currency: "EUR",
      receivedAt: minutesAgo(20),
      status: "payment",
      statusLabel: "To confirm",
      nextAction: "Review availability",
      email: { status: "sent", recipient: "sofia@example.com", processedAt: "2026-10-31T10:19:00.000Z" },
      whatsapp: { status: "sent", recipient: "+491701234567", processedAt: "2026-10-31T10:19:08.000Z" },
    },
];

const demoNames = ["Emma Wilson", "Noah Martin", "Olivia Brown", "Liam Garcia", "Mia Taylor", "Ethan Davis", "Ava Moore", "Leo Anderson"];
const generatedRequests: HotelRequest[] = Array.from({ length: 283 }, (_, index) => {
  const status: HotelRequest["status"] = index < 22 ? "payment" : index < 25 ? "attention" : index < 97 ? "waiting" : "new";
  const totalCents = 28_000 + (index % 7) * 9_500;
  const failed = status === "attention";
  return {
    id: `req_demo_${index}`,
    guestName: demoNames[index % demoNames.length]!,
    stayLabel: `${3 + (index % 20)}–${5 + (index % 20)} November · 2 nights`,
    guestLabel: index % 4 === 0 ? "2 adults · 1 child" : "2 adults",
    roomLabel: index % 3 === 0 ? "Deluxe Room" : index % 3 === 1 ? "Classic Double" : "Junior Suite",
    totalLabel: new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(totalCents / 100),
    totalCents,
    currency: "EUR",
    receivedAt: minutesAgo(28 + (index % 180) * 4),
    status,
    statusLabel: status === "payment" ? "To confirm" : status === "attention" ? "Not delivered" : status === "new" ? "New request" : "Waiting for guest",
    ...(status === "payment" ? { nextAction: "Review availability" } : failed ? { nextAction: "Review delivery" } : {}),
    ...(failed ? { attentionReason: "EMAIL_DELIVERY_FAILED" } : {}),
    email: { status: failed ? "failed" : "sent", recipient: `guest${index + 1}@example.com`, lastErrorCode: failed ? "GMAIL_ACCESS_REVOKED" : null },
    whatsapp: { status: index % 4 === 0 ? "unused" : "sent", recipient: `+39333000${String(index).padStart(4, "0")}` },
  };
});

export const mockDashboard: DashboardSnapshot = {
  totalCount: 286,
  newCount: 186,
  waitingCount: 72,
  paymentPendingCount: 24,
  paymentPendingTotalCents: 1_584_000,
  attentionCount: 4,
  requests: [...primaryRequests, ...generatedRequests],
};
