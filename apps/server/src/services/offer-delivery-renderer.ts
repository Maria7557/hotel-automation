import {
  escapeHtml,
  formatDate,
  formatMoney,
  renderEmailHtml,
  renderEmailSubject,
  renderEmailText,
  renderWhatsAppText,
  requirePublicOfferUrl,
  safeHeaderText,
  type OfferSnapshot,
} from "@hotel/templates";

import type { MessageSettings } from "../repositories/types.js";

export type RenderedOfferDelivery =
  | { channel: "email"; subject: string; text: string; html: string }
  | { channel: "whatsapp"; text: string };

export function renderOfferDelivery(input: {
  snapshot: Record<string, unknown>;
  proposalUrl: string;
  channel: "email" | "whatsapp";
  settings: MessageSettings | null;
  locale: string;
}): RenderedOfferDelivery {
  const snapshot = requireOfferSnapshot(input.snapshot);
  const publicOfferUrl = requirePublicOfferUrl(input.proposalUrl);
  const context = { publicOfferUrl, locale: input.locale };

  // The canonical template render is the safe fallback and validates the same
  // immutable snapshot/URL used by custom hotel copy.
  const canonical =
    input.channel === "email"
      ? {
          channel: "email" as const,
          subject: renderEmailSubject(snapshot, context),
          text: renderEmailText(snapshot, context),
          html: renderEmailHtml(snapshot, context),
        }
      : {
          channel: "whatsapp" as const,
          text: renderWhatsAppText(snapshot, context),
        };
  if (!input.settings) return canonical;

  const values = offerVariables(snapshot, publicOfferUrl, input.locale);
  if (input.channel === "whatsapp") {
    return {
      channel: "whatsapp",
      text: renderText(input.settings.whatsappBodyTemplate, values),
    };
  }
  const subject = safeHeaderText(renderText(input.settings.emailSubjectTemplate, values));
  const text = renderText(input.settings.emailBodyTemplate, values);
  return {
    channel: "email",
    subject,
    text,
    html: safeEmailHtml(subject, text),
  };
}

function requireOfferSnapshot(value: Record<string, unknown>): OfferSnapshot {
  const hotel = value.hotelSnapshot;
  const guest = value.guestSnapshot;
  const options = value.options;
  if (
    typeof value.inquiryId !== "string" ||
    typeof hotel !== "object" ||
    hotel === null ||
    typeof guest !== "object" ||
    guest === null ||
    !Array.isArray(options)
  ) {
    throw new Error("Invalid offer snapshot.");
  }
  return value as unknown as OfferSnapshot;
}

function offerVariables(
  snapshot: OfferSnapshot,
  proposalUrl: string,
  locale: string,
): Record<string, string> {
  const lowestTotal = snapshot.options.reduce<number | null>(
    (lowest, option) =>
      lowest === null || option.totalCents < lowest ? option.totalCents : lowest,
    null,
  );
  return {
    guest_name: snapshot.guestSnapshot.name,
    hotel_name: snapshot.hotelSnapshot.name,
    check_in: formatDate(snapshot.guestSnapshot.checkIn, locale),
    check_out: formatDate(snapshot.guestSnapshot.checkOut, locale),
    guest_count: String(
      snapshot.guestSnapshot.occupancy.adults +
        snapshot.guestSnapshot.occupancy.childAges.length,
    ),
    total: lowestTotal === null ? "" : formatMoney(lowestTotal, locale),
    offer_url: proposalUrl,
  };
}

function renderText(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(
    /{{\s*([a-z_][a-z0-9_]*)\s*}}/g,
    (_match, variable: string) => values[variable] ?? "",
  );
}

function safeEmailHtml(subject: string, text: string): string {
  const safeBody = escapeHtml(text).replace(/\n/g, "<br>");
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"></head><body style="margin:0;background:#f1f1f1;color:#202020;font-family:Poppins,Inter,Arial,sans-serif"><main style="max-width:600px;margin:0 auto;padding:32px 20px"><section style="background:#fff;border-radius:20px;padding:24px"><h1 style="font-size:22px;line-height:28px">${escapeHtml(subject)}</h1><p style="font-size:16px;line-height:24px">${safeBody}</p></section></main></body></html>`;
}
