import type { NotificationRepository } from "../repositories/types.js";

export type NotificationEvent =
  | { type: "inquiry"; hotelId: string; inquiryId: string; guestName: string; checkIn: string; checkOut: string; attentionReason: string | null }
  | { type: "payment"; hotelId: string; inquiryId: string; guestName: string }
  | { type: "error"; hotelId: string; inquiryId: string; guestName: string; message: string };

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
};

export interface PushNotificationProvider {
  send(messages: PushMessage[]): Promise<Array<{ token: string; ok: boolean; deviceNotRegistered: boolean }>>;
}

export interface PlatformNotificationMailer {
  readonly configured: boolean;
  send(input: { to: string; subject: string; text: string }): Promise<void>;
}

export class NotificationService {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly pushProvider: PushNotificationProvider,
    private readonly mailer: PlatformNotificationMailer,
  ) {}

  async settings(userId: string) {
    const current = await this.repository.findPreferencesForUser(userId);
    if (!current) return null;
    return {
      pushPaymentsAndErrors: true,
      pushAllRequests: current.preferences?.pushAllRequests ?? false,
      pushDeviceRegistered: current.devices.length > 0,
      pushDeviceCount: current.devices.length,
      emailIncomingRequests: current.preferences?.emailIncomingRequests ?? false,
      emailAddress: current.preferences?.emailAddress ?? current.user.email,
      emailDeliveryAvailable: this.mailer.configured,
    };
  }

  async updateSettings(userId: string, input: { pushAllRequests: boolean; emailIncomingRequests: boolean; emailAddress: string | null }) {
    await this.repository.upsertPreferencesForUser(userId, input);
    return this.settings(userId);
  }

  async registerDevice(userId: string, input: { expoPushToken: string; platform: string; deviceName: string | null }) {
    const device = await this.repository.registerPushDeviceForUser(userId, input);
    return device ? this.settings(userId) : null;
  }

  async unregisterDevice(userId: string, expoPushToken: string) {
    await this.repository.deactivatePushDeviceForUser(userId, expoPushToken);
    return this.settings(userId);
  }

  async notify(event: NotificationEvent): Promise<void> {
    const targets = await this.repository.listTargetsForHotel(event.hotelId);
    const content = notificationContent(event);
    const messages: PushMessage[] = [];
    const emailTasks: Promise<void>[] = [];

    for (const target of targets) {
      const pushEnabled = event.type !== "inquiry"
        || Boolean(event.attentionReason)
        || (target.preferences?.pushAllRequests ?? false);
      if (pushEnabled) {
        for (const device of target.devices) {
          messages.push({
            to: device.expoPushToken,
            title: content.title,
            body: content.body,
            data: { event: event.type, inquiryId: event.inquiryId },
          });
        }
      }

      if (
        event.type === "inquiry"
        && target.preferences?.emailIncomingRequests
        && target.preferences.emailAddress
        && this.mailer.configured
      ) {
        emailTasks.push(this.mailer.send({
          to: target.preferences.emailAddress,
          subject: `New request: ${event.guestName}`,
          text: `${event.guestName}\n${event.checkIn} — ${event.checkOut}${event.attentionReason ? `\nNeeds attention: ${event.attentionReason}` : ""}`,
        }));
      }
    }

    const tasks: Promise<unknown>[] = [...emailTasks];
    if (messages.length > 0) {
      tasks.push(this.pushProvider.send(messages).then((results) => Promise.all(results
        .filter(({ deviceNotRegistered }) => deviceNotRegistered)
        .map(({ token }) => this.repository.deactivatePushDeviceByToken(token)))));
    }
    await Promise.allSettled(tasks);
  }
}

function notificationContent(event: NotificationEvent): { title: string; body: string } {
  if (event.type === "payment") {
    return { title: "Guest accepted", body: `${event.guestName} is waiting for confirmation and payment.` };
  }
  if (event.type === "error") {
    return { title: "Action required", body: `${event.guestName}: ${event.message}` };
  }
  if (event.attentionReason) {
    return { title: "New request needs attention", body: `${event.guestName}: review dates, room and rates.` };
  }
  return { title: "New request", body: `${event.guestName} · ${event.checkIn} — ${event.checkOut}` };
}
