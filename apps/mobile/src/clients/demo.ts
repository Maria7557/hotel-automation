import { mockDashboard } from "../api/mock";
import { DEFAULT_GUEST_LANGUAGE } from "@hotel/contracts";
import type { ClientFilterOptions, ClientFilters, ClientInput, ClientProfile, ClientHistory, ClientPage, HotelRequest } from "../api/types";

const requestLinks = new Map<string, string>();
const contacts: ClientProfile[] = [];
export function demoCreateClient(input: ClientInput) {
  const existing = contacts.find((c) => (input.email && c.email?.toLowerCase() === input.email.toLowerCase()) || (input.phone && c.phone === input.phone));
  if (existing) return { client: existing, created: false };
  const client: ClientProfile = { ...input, id: `demo-client-${contacts.length + 1}`, source: "manual", firstInquiryAt: null, lastInquiryAt: null, createdAt: new Date().toISOString(), requestCount: 0 };
  contacts.unshift(client);
  return { client, created: true };
}
export function demoAddRequestClient(id: string) {
  if (requestLinks.has(id)) return demoGetClient(requestLinks.get(id)!);
  const request = mockDashboard.requests.find((r) => r.id === id);
  if (!request) throw new Error("Request was not found.");
  const client = demoCreateClient({ name: request.guestName, email: request.email.recipient ?? `${id}@example.com`, phone: request.whatsapp.recipient ?? null, locale: request.locale ?? DEFAULT_GUEST_LANGUAGE, notes: "" }).client;
  client.source = "inquiry";
  client.firstInquiryAt ??= request.receivedAt;
  client.lastInquiryAt = request.receivedAt;
  client.requestCount++;
  requestLinks.set(id, client.id);
  return client;
}
for (const request of mockDashboard.requests.slice(0, 2)) demoAddRequestClient(request.id);
export function demoClientStatuses(ids: string[]) { return ids.map((inquiryId) => ({ inquiryId, inContacts: requestLinks.has(inquiryId), clientId: requestLinks.get(inquiryId) ?? null })); }
export function demoLinkRequestClient(inquiryId: string, clientId: string) {
  if (requestLinks.has(inquiryId)) return;
  const request = mockDashboard.requests.find(({ id }) => id === inquiryId);
  if (!request) throw new Error("Request was not found.");
  const client = demoGetClient(clientId);
  requestLinks.set(inquiryId, clientId);
  client.firstInquiryAt ??= request.receivedAt;
  client.lastInquiryAt = request.receivedAt;
  client.requestCount++;
}
// Demo fixtures implement the API contract without making reservation-detail requests.
export function demoClientFilterOptions(): ClientFilterOptions {
  return {
    rooms: [...new Set(mockDashboard.requests.map((request) => request.roomLabel))].map((name, index) => ({ id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`, name, archived: false })),
    locales: [...new Set(contacts.map((client) => client.locale))].sort(),
  };
}
export function demoListClients(search: string, filters: ClientFilters = {}): ClientPage {
  const query = search.trim().toLowerCase();
  const selectedRoom = demoClientFilterOptions().rooms.find((room) => room.id === filters.roomId)?.name;
  const inRange = (value: number, min?: number, max?: number) => (min === undefined || value >= min) && (max === undefined || value <= max);
  const hasStayFilters = [filters.stayFrom, filters.stayTo, filters.minGuests, filters.maxGuests, filters.minAdults, filters.maxAdults,
    filters.minChildren, filters.maxChildren, filters.minNights, filters.maxNights, filters.roomId, filters.mealPlan, filters.status].some((value) => value !== undefined);
  const matchesStay = (request: HotelRequest) => {
    const { adults, childAges } = request.occupancy;
    const nights = (Date.parse(request.checkOut) - Date.parse(request.checkIn)) / 86_400_000;
    return (!filters.stayFrom || request.checkOut > filters.stayFrom) && (!filters.stayTo || request.checkIn <= filters.stayTo)
      && inRange(adults + childAges.length, filters.minGuests, filters.maxGuests)
      && inRange(adults, filters.minAdults, filters.maxAdults) && inRange(childAges.length, filters.minChildren, filters.maxChildren)
      && inRange(nights, filters.minNights, filters.maxNights) && (!filters.roomId || request.roomLabel === selectedRoom)
      && (!filters.mealPlan || request.mealPlan === filters.mealPlan) && (!filters.status || request.status === filters.status);
  };
  return { clients: contacts.filter((client) => {
    if (![client.name, client.email, client.phone].some((value) => value?.toLowerCase().includes(query))) return false;
    if (filters.source && client.source !== filters.source || filters.locale && client.locale !== filters.locale) return false;
    if ((filters.contact === "email" || filters.contact === "both") && !client.email) return false;
    if ((filters.contact === "phone" || filters.contact === "both") && !client.phone) return false;
    if (filters.notes && Boolean(client.notes.trim()) !== (filters.notes === "with")) return false;
    if (filters.addedFrom && client.createdAt.slice(0, 10) < filters.addedFrom || filters.addedTo && client.createdAt.slice(0, 10) > filters.addedTo) return false;
    if (filters.reservations && (client.requestCount > 0) !== (filters.reservations === "with")) return false;
    return !hasStayFilters || mockDashboard.requests.some((request) => requestLinks.get(request.id) === client.id && matchesStay(request));
  }), nextCursor: null };
}
export function demoGetClient(id: string): ClientProfile {
  const client = contacts.find((item) => item.id === id);
  if (!client) throw new Error("Client was not found.");
  return client;
}
export function demoClientHistory(clientId: string): ClientHistory {
  return { requests: mockDashboard.requests.filter((r) => requestLinks.get(r.id) === clientId), nextCursor: null };
}
