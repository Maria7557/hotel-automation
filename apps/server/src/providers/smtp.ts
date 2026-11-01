import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { ProviderError } from "./http.js";
import type { GmailMessage } from "./google.js";

export type SmtpCredentials = { email: string; hostname: string; port: 465 | 587; username: string; appPassword: string; encryption: "tls" | "starttls" };
export type AddressResolver = (hostname: string) => Promise<readonly { address: string; family: number }[]>;

export function parseSmtpCredentials(value: unknown): SmtpCredentials {
  const v = value as Partial<SmtpCredentials> | null;
  if (!v || typeof v.email !== "string" || typeof v.hostname !== "string" || typeof v.username !== "string" || typeof v.appPassword !== "string" ||
    (v.port !== 465 && v.port !== 587) || (v.encryption !== "tls" && v.encryption !== "starttls") ||
    (v.port === 465 && v.encryption !== "tls") || (v.port === 587 && v.encryption !== "starttls")) throw new ProviderError("SMTP_CREDENTIALS_INVALID", false);
  return v as SmtpCredentials;
}

export async function resolveSafeSmtpHost(hostname: string, resolver: AddressResolver = async (host) => dnsLookup(host, { all: true, verbatim: true })) {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal") throw new ProviderError("SMTP_HOST_FORBIDDEN", false);
  const addresses = await resolver(host);
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new ProviderError("SMTP_HOST_FORBIDDEN", false);
  return { hostname: host, addresses: addresses.map(({ address }) => address) };
}

export class SmtpProvider {
  async send(credentials: SmtpCredentials, message: GmailMessage) {
    const safe = await resolveSafeSmtpHost(credentials.hostname);
    const pinned = safe.addresses[0]!;
    const options: SMTPTransport.Options & { lookup: (hostname: string, options: object, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) => void } = {
      host: safe.hostname, port: credentials.port, secure: credentials.port === 465, requireTLS: credentials.port === 587,
      auth: { user: credentials.username, pass: credentials.appPassword }, tls: { rejectUnauthorized: true, servername: safe.hostname },
      lookup: (_hostname, _options, callback) => callback(null, pinned, isIP(pinned)),
    };
    const transport = nodemailer.createTransport(options);
    try {
      const result = await transport.sendMail({ from: credentials.email, to: message.to, subject: message.subject, html: message.html });
      if (!result.accepted.length) throw new ProviderError("SMTP_NOT_ACCEPTED", false);
      return { providerMessageId: result.messageId || null };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("SMTP_SEND_FAILED", false);
    }
  }
}

function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b! >= 16 && b! <= 31 || a === 192 && b === 168 || a! >= 224 || address === "100.100.100.200");
  }
  if (isIP(address) === 6) {
    const v = address.toLowerCase();
    return !(v === "::" || v === "::1" || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168."));
  }
  return false;
}
