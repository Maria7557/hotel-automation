import nodemailer from "nodemailer";

import type { PlatformNotificationMailer, PushMessage, PushNotificationProvider } from "../services/notifications.js";
import type { ProviderFetch } from "./http.js";

type ExpoTicket = { status?: string; details?: { error?: string } };

export class ExpoPushProvider implements PushNotificationProvider {
  constructor(private readonly providerFetch: ProviderFetch = fetch, private readonly accessToken?: string) {}

  async send(messages: PushMessage[]) {
    const response = await this.providerFetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify(messages.map((message) => ({ ...message, sound: "default", priority: "high" }))),
    });
    if (!response.ok) throw new Error(`Expo push request failed with ${response.status}.`);
    const payload = await response.json() as { data?: ExpoTicket[] };
    const tickets = Array.isArray(payload.data) ? payload.data : [];
    return messages.map((message, index) => {
      const ticket = tickets[index];
      return {
        token: message.to,
        ok: ticket?.status === "ok",
        deviceNotRegistered: ticket?.details?.error === "DeviceNotRegistered",
      };
    });
  }
}

type MailConfig = {
  host?: string | undefined;
  port?: number | undefined;
  username?: string | undefined;
  password?: string | undefined;
  fromEmail?: string | undefined;
  fromName?: string | undefined;
};

export class SmtpNotificationMailer implements PlatformNotificationMailer {
  readonly configured: boolean;

  constructor(private readonly config: MailConfig) {
    this.configured = Boolean(config.host && config.port && config.username && config.password && config.fromEmail);
  }

  async send(input: { to: string; subject: string; text: string }): Promise<void> {
    if (!this.configured) return;
    const transport = nodemailer.createTransport({
      host: this.config.host!,
      port: this.config.port!,
      secure: this.config.port === 465,
      auth: { user: this.config.username!, pass: this.config.password! },
    });
    await transport.sendMail({
      from: this.config.fromName ? `"${this.config.fromName.replace(/["\r\n]/g, "")}" <${this.config.fromEmail}>` : this.config.fromEmail,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
  }
}
