import { supportedLanguage, translate } from "@hotel/i18n";
import type { FastifyInstance } from "fastify";
import { DEFAULT_GUEST_LANGUAGE, templateLanguages } from "@hotel/contracts";
import { widgetFormScript } from "../widget-form.js";
import { errors } from "../../lib/errors.js";
import type { AutomationRepository } from "../../repositories/types.js";
import { publicHotelParamsSchema } from "../public-schemas.js";

const widgetKeys = ["Board basis", "Check-in", "Check-out", "Full name", "Email", "Phone / WhatsApp", "Adults", "Children", "Select age", "Select the child’s age.", "Under 1 year", "1 year old", "{{v0}} years old", "Child {{v0}} age", "Select each child’s age at check-in to calculate the child rate.", "Message", "Website", "Request availability", "Sending…", "Request sent. You will receive our offer shortly.", "Request sent. The hotel will review your message before sending an offer.", "Could not send the request. Try again or contact the hotel directly.", "Choose BB, HB or FB before sending your request.", "Preview only. No enquiry was sent.", "First name", "Last name", "Treatment", "Select board basis", "BB · Bed and breakfast", "HB · Half board", "FB · Full board", "Add room", "Remove room", "Add alternative dates", "Remove alternative dates", "Alternative check-in", "Alternative check-out", "Message (optional)", "Guest language", "Include the country code, e.g. +39.", "Privacy Policy", "I agree to receive offers and news (optional)", "I consent to the processing of my data", "Request sent. The hotel will review your request before sending an offer."];
const widgetCopy = Object.fromEntries((["en", "it"] as const).map((language) => [language, Object.fromEntries(widgetKeys.map((key) => [key, translate(language, key)]))]));

const embedScript = String.raw`/*
Widget: <script async src="https://YOUR_API/embed.js" data-public-key="YOUR_PUBLIC_KEY"></script>
Existing form adapter: <script async src="https://YOUR_API/embed.js" data-public-key="YOUR_PUBLIC_KEY" data-mode="adapter" data-form="#booking-form"></script>
Tag fields with data-hotel-field="checkIn|checkOut|name|firstName|lastName|email|phone|language|adults|childAges|mealPlan|note".
Alternatively map them on the script with data-check-in, data-check-out, data-name, data-email,
data-phone, data-guest-language, data-adults, data-child-ages, data-meal-plan and data-note CSS selectors.
Use one age select per child; data-child-ages must match every child age select.
Set data-lang="en" or "it" to choose the widget language. data-language remains supported for guest communication.
*/
(() => {
  const script = document.currentScript;
  const publicKey = script && script.dataset.publicKey;
  if (!script || !publicKey || !/^[0-9a-f-]{36}$/i.test(publicKey)) return;
  const apiBase = new URL(script.src).origin;
  const signal = globalThis.OspioSignal || null;
  const normalizeLanguage = (value) => /^(en|it)(?:[-_]|$)/i.test(value || "") ? value.slice(0, 2).toLowerCase() : null;
  const language = normalizeLanguage(script.dataset.lang || script.dataset.language) || normalizeLanguage(document.documentElement.lang) || "it";
  const copy = ${JSON.stringify(widgetCopy)}[language];
  const guestLanguages = ${JSON.stringify(templateLanguages)};
  const t = (key, values = {}) => (copy[key] || key).replace(/\{\{(\w+)\}\}/g, (_, name) => values[name] == null ? "" : String(values[name]));

  const postInquiry = async (values, sourceType, form) => {
    if (!["BB", "HB", "FB"].includes(values.mealPlan)) throw new Error(t("Choose BB, HB or FB before sending your request."));
    const ages = (Array.isArray(values.childAges) ? values.childAges : String(values.childAges || "").split(",").map((value) => value.trim()).filter(Boolean)).map(Number);
    if ((Array.isArray(values.childAges) && values.childAges.some((age) => String(age).trim() === "")) || ages.some((age) => !Number.isInteger(age) || age < 0 || age > 17)) throw new Error(t("Select the child’s age."));
    const input = apiBase + "/v1/public/hotels/" + encodeURIComponent(publicKey) + "/inquiries";
    const init = {
      method: "POST",
      keepalive: sourceType === "existing_form",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random() },
      body: JSON.stringify({
        guest: { name: String(values.name || ""), email: String(values.email || "") || null, phone: String(values.phone || "") || null, language: String(values.language || script.dataset.language || script.dataset.lang || ${JSON.stringify(DEFAULT_GUEST_LANGUAGE)}) },
        checkIn: String(values.checkIn || ""), checkOut: String(values.checkOut || ""),
        occupancy: { adults: Number(values.adults || 1), childAges: ages },
        mealPlan: values.mealPlan,
        note: String(values.note || ""), website: String(values.website || ""), details: values.details,
        source: { type: sourceType, page: location.origin + location.pathname, widgetVersion: "v1" }
      })
    };
    return signal && form ? signal.request(form, input, init, "/v1/public/hotels/:publicKey/inquiries") : fetch(input, init);
  };

  if (script.dataset.mode === "adapter") {
    const formSelector = script.dataset.form || "[data-hotel-inquiry-form]";
    let form;
    try { form = document.querySelector(formSelector); } catch (_) { return; }
    if (!form || form.dataset.hotelInquiryBound === "true") return;
    form.dataset.hotelInquiryBound = "true";
    if (signal) signal.bind(form, "FormAdapter");

    const fieldSelectors = {
      checkIn: script.dataset.checkIn,
      checkOut: script.dataset.checkOut,
      name: script.dataset.name,
      firstName: script.dataset.firstName,
      lastName: script.dataset.lastName,
      email: script.dataset.email,
      phone: script.dataset.phone,
      language: script.dataset.guestLanguage,
      adults: script.dataset.adults,
      childAges: script.dataset.childAges,
      mealPlan: script.dataset.mealPlan,
      note: script.dataset.note,
      website: script.dataset.website
    };
    const read = (field) => {
      const selector = fieldSelectors[field] || '[data-hotel-field="' + field + '"]';
      if (field === "childAges") {
        let elements;
        try { elements = Array.from(form.querySelectorAll(selector)); } catch (_) { return []; }
        const selects = elements.filter((element) => element.tagName === "SELECT");
        if (selects.length) return selects.flatMap((element) => Array.from(element.selectedOptions, (option) => option.value));
      }
      let element;
      try { element = form.querySelector(selector); } catch (_) { return ""; }
      if (!element) return "";
      if (element.type === "radio") { const selected = form.querySelector(selector + ":checked"); return selected ? selected.value : ""; }
      if (element.type === "checkbox") return element.checked ? element.value || "true" : "";
      return element.value == null ? "" : element.value;
    };
    const status = form.querySelector("[data-hotel-inquiry-status]");
    const replaceOriginal = script.dataset.submitBehavior === "replace";
    const setStatus = (state, text) => {
      if (status) { status.dataset.state = state; status.textContent = text; }
      form.dispatchEvent(new CustomEvent("hotel-inquiry:" + state, { bubbles: true }));
    };

    form.addEventListener("submit", async (event) => {
      if (replaceOriginal) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      const submitters = form.querySelectorAll('button[type="submit"],input[type="submit"]');
      if (replaceOriginal) submitters.forEach((element) => { element.disabled = true; });
      setStatus("sending", t("Sending…"));
      try {
        const response = await postInquiry({
          checkIn: read("checkIn"), checkOut: read("checkOut"), name: read("name") || [read("firstName"), read("lastName")].filter(Boolean).join(" "),
          details: read("firstName") && read("lastName") ? { firstName: read("firstName"), lastName: read("lastName") } : undefined,
          email: read("email"), phone: read("phone"), language: read("language"), adults: read("adults") || 1,
          childAges: read("childAges"), mealPlan: read("mealPlan"), note: read("note"), website: read("website")
        }, "existing_form", form);
        if (!response.ok) throw new Error("request_failed");
        setStatus("success", read("note").trim() ? t("Request sent. The hotel will review your message before sending an offer.") : t("Request sent. You will receive our offer shortly."));
        if (signal) signal.finish(form);
      } catch (_) {
        if (signal) signal.finish(form, new Error("Submission failed"));
        setStatus("error", t("Could not send the request. Try again or contact the hotel directly."));
      } finally {
        if (replaceOriginal) submitters.forEach((element) => { element.disabled = false; });
      }
    }, { capture: true });
    return;
  }

  ${widgetFormScript}
})();`;

export async function registerEmbedRoutes(app: FastifyInstance, repository: Pick<AutomationRepository, "findPublicHotelByKey">): Promise<void> {
  app.get("/embed.js", async (_request, reply) =>
    reply
      .header("Cache-Control", "public, max-age=300")
      .header("X-Content-Type-Options", "nosniff")
      .type("application/javascript; charset=utf-8")
      .send(app.signalBrowserScript + embedScript),
  );

  app.get("/v1/public/hotels/:publicKey/widget.css", { config: { cors: { origin: true } } }, async (request, reply) => {
    const { publicKey } = publicHotelParamsSchema.parse(request.params);
    const hotel = await repository.findPublicHotelByKey(publicKey);
    if (!hotel) throw errors.hotelNotFound();
    return reply.header("Cache-Control", "no-cache")
      .header("X-Content-Type-Options", "nosniff")
      .type("text/css; charset=utf-8").send(hotel.widgetCss);
  });

  app.get("/v1/public/hotels/:publicKey/widget-preview", async (request, reply) => {
    const { publicKey } = publicHotelParamsSchema.parse(request.params);
    if (!(await repository.findPublicHotelByKey(publicKey))) throw errors.hotelNotFound();
    const language = supportedLanguage((request.query as { lang?: string }).lang) ?? "it";
    return reply.header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "form-action 'none'; base-uri 'none'; frame-ancestors 'none'")
      .type("text/html; charset=utf-8")
      .send(`<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${translate(language, "Form preview")}</title></head><body><script src="/embed.js" data-public-key="${publicKey}" data-lang="${language}" data-preview="true"></script></body></html>`);
  });
}
