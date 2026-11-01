import { resolveMx } from "node:dns/promises";

export type MailProviderKind = "google" | "microsoft" | "smtp";
export type MxResolver = (domain: string) => Promise<readonly { exchange: string; priority: number }[]>;

export async function detectMailProvider(email: string, resolver: MxResolver = resolveMx): Promise<{ provider: MailProviderKind; confidence: "high" | "suggested" }> {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at < 1 || at === normalized.length - 1) throw new Error("INVALID_EMAIL");
  const domain = normalized.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") return { provider: "google", confidence: "high" };
  try {
    const hosts = (await resolver(domain)).map(({ exchange }) => exchange.toLowerCase().replace(/\.$/, ""));
    if (hosts.some((host) => host.endsWith(".google.com") || host.endsWith(".googlemail.com"))) return { provider: "google", confidence: "suggested" };
    if (hosts.some((host) => host.endsWith(".outlook.com") || host.endsWith(".protection.outlook.com"))) return { provider: "microsoft", confidence: "suggested" };
  } catch { /* Unknown or unavailable MX falls back to manual SMTP. */ }
  return { provider: "smtp", confidence: "suggested" };
}
