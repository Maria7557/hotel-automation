import { copyFor, formatGuests, formatMoney, formatStay } from "./content.js";
import { escapeHtml, requirePublicOfferUrl, safeHeaderText, safeImageUrl } from "./security.js";
import type { MessageRenderContext, OfferSnapshot } from "./types.js";

function lowestPrice(snapshot: OfferSnapshot): number | null {
  return snapshot.options.reduce<number | null>(
    (lowest, option) => (lowest === null || option.totalCents < lowest ? option.totalCents : lowest),
    null,
  );
}

export function renderEmailSubject(snapshot: OfferSnapshot, context: MessageRenderContext): string {
  const copy = copyFor(context.locale);
  return safeHeaderText(copy.title(snapshot.hotelSnapshot.name));
}

export function renderEmailText(snapshot: OfferSnapshot, context: MessageRenderContext): string {
  const copy = copyFor(context.locale);
  const offerUrl = requirePublicOfferUrl(context.publicOfferUrl);
  const price = lowestPrice(snapshot);
  return [
    copy.greeting(snapshot.guestSnapshot.name),
    "",
    copy.emailIntro,
    `${copy.stay}: ${formatStay(snapshot, context.locale)}`,
    `${copy.guests}: ${formatGuests(snapshot, context.locale)}`,
    price === null ? null : `${copy.perStay}: ${formatMoney(price, context.locale)}`,
    "",
    `${copy.emailCta}: ${offerUrl}`,
    "",
    copy.emailOutro,
    snapshot.hotelSnapshot.name,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function renderWhatsAppText(snapshot: OfferSnapshot, context: MessageRenderContext): string {
  const copy = copyFor(context.locale);
  const offerUrl = requirePublicOfferUrl(context.publicOfferUrl);
  const price = lowestPrice(snapshot);
  return [
    copy.greeting(snapshot.guestSnapshot.name),
    copy.whatsappIntro,
    `${copy.stay}: ${formatStay(snapshot, context.locale)}`,
    price === null ? null : `${copy.perStay}: ${formatMoney(price, context.locale)}`,
    offerUrl,
    snapshot.hotelSnapshot.name,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function renderEmailHtml(snapshot: OfferSnapshot, context: MessageRenderContext): string {
  const copy = copyFor(context.locale);
  const offerUrl = requirePublicOfferUrl(context.publicOfferUrl);
  const price = lowestPrice(snapshot);
  const logoUrl = safeImageUrl(snapshot.hotelSnapshot.logoUrl);
  return `<!doctype html>
<html lang="${context.locale?.toLowerCase().startsWith("en") ? "en" : "it"}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(copy.title(snapshot.hotelSnapshot.name))}</title></head>
<body style="margin:0;background:#f1f1f1;color:#202020;font-family:Poppins,Inter,Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f1f1"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden">
      <tr><td style="padding:32px 24px">
        ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(snapshot.hotelSnapshot.name)}" width="64" style="display:block;max-width:64px;height:auto;margin-bottom:24px">` : ""}
        <h1 style="margin:0 0 16px;font-size:24px;line-height:32px">${escapeHtml(copy.greeting(snapshot.guestSnapshot.name))}</h1>
        <p style="margin:0 0 24px;font-size:16px;line-height:24px">${escapeHtml(copy.emailIntro)}</p>
        <div style="padding:20px;background:#edf3fc;border-radius:16px">
          <p style="margin:0 0 8px"><strong>${escapeHtml(copy.stay)}:</strong> ${escapeHtml(formatStay(snapshot, context.locale))}</p>
          <p style="margin:0${price === null ? "" : " 0 8px"}"><strong>${escapeHtml(copy.guests)}:</strong> ${escapeHtml(formatGuests(snapshot, context.locale))}</p>
          ${price === null ? "" : `<p style="margin:0"><strong>${escapeHtml(copy.perStay)}:</strong> ${escapeHtml(formatMoney(price, context.locale))}</p>`}
        </div>
        <p style="margin:24px 0"><a href="${escapeHtml(offerUrl)}" style="display:inline-block;padding:16px 24px;border-radius:12px;background:#1769ff;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600">${escapeHtml(copy.emailCta)}</a></p>
        <p style="margin:0;color:#4a4a4a;font-size:14px;line-height:20px">${escapeHtml(copy.emailOutro)}<br>${escapeHtml(snapshot.hotelSnapshot.name)}</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
