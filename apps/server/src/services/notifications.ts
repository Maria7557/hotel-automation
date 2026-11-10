import { resolveLanguage, translate, type Language } from "@hotel/i18n";
import type { NotificationRepository } from "../repositories/types.js";
import type { MealPlan } from "@hotel/contracts";

export type NotificationEvent =
  | { type: "inquiry"; hotelId: string; inquiryId: string; guestName: string; checkIn: string; checkOut: string; mealPlan: MealPlan; attentionReason: string | null }
  | { type: "payment"; hotelId: string; inquiryId: string; guestName: string; mealPlan: MealPlan }
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
    const messages: PushMessage[] = [];
    const emailTasks: Promise<void>[] = [];

    for (const target of targets) {
      const language = resolveLanguage(target.user.uiLanguage);
      const content = notificationContent(event, language);
      const pushEnabled = event.type !== "inquiry"
        || Boolean(event.attentionReason)
        || (target.preferences?.pushAllRequests ?? false);
      if (pushEnabled) {
        for (const device of target.devices) {
          messages.push({
            to: device.expoPushToken,
            title: content.title,
            body: content.body,
            data: { event: event.type, inquiryId: event.inquiryId, ...(event.type === "error" ? {} : { mealPlan: event.mealPlan }) },
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
          subject: `${event.mealPlan} · ${translate(language, "New request: {{v0}}", { v0: event.guestName })}`,
          text: `${event.mealPlan} · ${event.guestName}\n${event.checkIn} — ${event.checkOut}${event.attentionReason ? `\n${translate(language, "Needs attention: {{v0}}", { v0: event.attentionReason })}` : ""}`,
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

function notificationContent(event: NotificationEvent, language: Language): { title: string; body: string } {
  if (event.type === "payment") {
    return { title: `${event.mealPlan} · ${translate(language, "Guest accepted")}`, body: translate(language, "{{v0}} is waiting for confirmation and payment.", { v0: event.guestName }) };
  }
  if (event.type === "error") {
    return { title: translate(language, "Action required"), body: `${event.guestName}: ${translate(language, event.message)}` };
  }
  if (event.attentionReason) {
    return { title: `${event.mealPlan} · ${translate(language, "New request needs attention")}`, body: translate(language, "{{v0}}: review {{v1}} rates, dates and room.", { v0: event.guestName, v1: event.mealPlan }) };
  }
  return { title: `${event.mealPlan} · ${translate(language, "New request")}`, body: `${event.guestName} · ${event.checkIn} — ${event.checkOut}` };
}
