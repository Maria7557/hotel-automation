import { describe, expect, it } from "vitest";

import { NotificationService, type PlatformNotificationMailer, type PushMessage, type PushNotificationProvider } from "../src/services/notifications.js";
import { createMemoryRepositories } from "./helpers/memory-repositories.js";

class PushSpy implements PushNotificationProvider {
  messages: PushMessage[] = [];
  async send(messages: PushMessage[]) {
    this.messages.push(...messages);
    return messages.map(({ to }) => ({ token: to, ok: true, deviceNotRegistered: false }));
  }
}

class MailSpy implements PlatformNotificationMailer {
  readonly configured = true;
  messages: Array<{ to: string; subject: string; text: string }> = [];
  async send(message: { to: string; subject: string; text: string }) { this.messages.push(message); }
}

describe("notification service", () => {
  it("keeps payment and error push mandatory while making all requests optional", async () => {
    const repositories = createMemoryRepositories();
    const user = await repositories.auth.createUser({ email: "owner@example.com", displayName: "Owner", passwordHash: "hash" });
    const hotel = await repositories.hotels.createForUser(user.id, {
      name: "Casa Blu", city: "Firenze", countryCode: "IT", locale: "en-GB", description: null,
      currency: "EUR", timezone: "Europe/Rome", email: null, phone: null, website: null, logoUrl: null,
      photoUrls: [], termsText: null,
    });
    await repositories.notifications.registerPushDeviceForUser(user.id, {
      expoPushToken: "ExponentPushToken[owner-phone]", platform: "ios", deviceName: "iPhone",
    });
    const push = new PushSpy();
    const mail = new MailSpy();
    const service = new NotificationService(repositories.notifications, push, mail);

    await service.notify({ type: "inquiry", hotelId: hotel.id, inquiryId: "inquiry-1", guestName: "Anna", checkIn: "2027-01-01", checkOut: "2027-01-02", attentionReason: null });
    expect(push.messages).toHaveLength(0);

    await service.notify({ type: "payment", hotelId: hotel.id, inquiryId: "inquiry-1", guestName: "Anna" });
    await service.notify({ type: "error", hotelId: hotel.id, inquiryId: "inquiry-1", guestName: "Anna", message: "Delivery failed." });
    expect(push.messages.map(({ title }) => title)).toEqual(["Guest accepted", "Action required"]);

    await repositories.notifications.upsertPreferencesForUser(user.id, {
      pushAllRequests: true, emailIncomingRequests: true, emailAddress: "desk@example.com",
    });
    await service.notify({ type: "inquiry", hotelId: hotel.id, inquiryId: "inquiry-2", guestName: "Marco", checkIn: "2027-02-01", checkOut: "2027-02-03", attentionReason: null });
    expect(push.messages.at(-1)?.title).toBe("New request");
    expect(mail.messages).toMatchObject([{ to: "desk@example.com", subject: "New request: Marco" }]);
  });
});
