import { translate } from "@hotel/i18n";
import type { FastifyInstance } from "fastify";
import { DEFAULT_GUEST_LANGUAGE } from "@hotel/contracts";
import { renderBoardBadge } from "@hotel/templates";

const boardChoices = Object.fromEntries((["en", "it"] as const).map((language) => [language, (["BB", "HB", "FB"] as const).map((board) => `<label class="board-choice"><input required type="radio" name="mealPlan" value="${board}">${renderBoardBadge(board, language)}</label>`).join("")]));

const widgetKeys = ["Board basis", "Check-in", "Check-out", "Full name", "Email", "Phone / WhatsApp", "Adults", "Child ages, separated by commas", "e.g. 4, 9", "Message", "Website", "Request availability", "Sending…", "Request sent. You will receive our offer shortly.", "Request sent. The hotel will review your message before sending an offer.", "Could not send the request. Try again or contact the hotel directly.", "Choose BB, HB or FB before sending your request."];
const widgetCopy = Object.fromEntries((["en", "it"] as const).map((language) => [language, Object.fromEntries(widgetKeys.map((key) => [key, translate(language, key)]))]));

const embedScript = String.raw`/*
Widget: <script async src="https://YOUR_API/embed.js" data-public-key="YOUR_PUBLIC_KEY"></script>
Existing form adapter: <script async src="https://YOUR_API/embed.js" data-public-key="YOUR_PUBLIC_KEY" data-mode="adapter" data-form="#booking-form"></script>
Tag fields with data-hotel-field="checkIn|checkOut|name|email|phone|language|adults|childAges|mealPlan|note".
Alternatively map them on the script with data-check-in, data-check-out, data-name, data-email,
data-phone, data-guest-language, data-adults, data-child-ages, data-meal-plan and data-note CSS selectors.
Set data-lang="en" or "it" to choose the widget language. data-language remains supported for guest communication.
*/
(() => {
  const script = document.currentScript;
  const publicKey = script && script.dataset.publicKey;
  if (!script || !publicKey || !/^[0-9a-f-]{36}$/i.test(publicKey)) return;
  const apiBase = new URL(script.src).origin;
  const normalizeLanguage = (value) => /^(en|it)(?:[-_]|$)/i.test(value || "") ? value.slice(0, 2).toLowerCase() : null;
  const language = normalizeLanguage(script.dataset.lang || script.dataset.language) || normalizeLanguage(document.documentElement.lang) || "it";
  const copy = ${JSON.stringify(widgetCopy)}[language];
  const t = (key) => copy[key] || key;

  const postInquiry = async (values, sourceType) => {
    if (!["BB", "HB", "FB"].includes(values.mealPlan)) throw new Error(t("Choose BB, HB or FB before sending your request."));
    const ages = String(values.childAges || "").split(",").map((value) => value.trim()).filter(Boolean).map(Number);
    return fetch(apiBase + "/v1/public/hotels/" + encodeURIComponent(publicKey) + "/inquiries", {
      method: "POST",
      keepalive: sourceType === "existing_form",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random() },
      body: JSON.stringify({
        guest: { name: String(values.name || ""), email: String(values.email || "") || null, phone: String(values.phone || "") || null, language: String(values.language || script.dataset.language || script.dataset.lang || ${JSON.stringify(DEFAULT_GUEST_LANGUAGE)}) },
        checkIn: String(values.checkIn || ""), checkOut: String(values.checkOut || ""),
        occupancy: { adults: Number(values.adults || 1), childAges: ages },
        mealPlan: values.mealPlan,
        note: String(values.note || ""), website: String(values.website || ""),
        source: { type: sourceType, page: location.origin + location.pathname, widgetVersion: "v1" }
      })
    });
  };

  if (script.dataset.mode === "adapter") {
    const formSelector = script.dataset.form || "[data-hotel-inquiry-form]";
    let form;
    try { form = document.querySelector(formSelector); } catch (_) { return; }
    if (!form || form.dataset.hotelInquiryBound === "true") return;
    form.dataset.hotelInquiryBound = "true";

    const fieldSelectors = {
      checkIn: script.dataset.checkIn,
      checkOut: script.dataset.checkOut,
      name: script.dataset.name,
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
          checkIn: read("checkIn"), checkOut: read("checkOut"), name: read("name"),
          email: read("email"), phone: read("phone"), language: read("language"), adults: read("adults") || 1,
          childAges: read("childAges"), mealPlan: read("mealPlan"), note: read("note"), website: read("website")
        }, "existing_form");
        if (!response.ok) throw new Error("request_failed");
        setStatus("success", read("note").trim() ? t("Request sent. The hotel will review your message before sending an offer.") : t("Request sent. You will receive our offer shortly."));
      } catch (_) {
        setStatus("error", t("Could not send the request. Try again or contact the hotel directly."));
      } finally {
        if (replaceOriginal) submitters.forEach((element) => { element.disabled = false; });
      }
    }, { capture: true });
    return;
  }

  const host = document.createElement("div");
  host.setAttribute("data-hotel-inquiry", publicKey);
  host.lang = language;
  script.insertAdjacentElement("afterend", host);
  const root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  root.innerHTML =
    '<style>*{box-sizing:border-box}.box{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202020;background:#fff;border:1px solid #e5e5e5;border-radius:16px;padding:20px;max-width:680px}.board-options{border:0;padding:0;margin:0;display:flex;gap:8px;flex-wrap:wrap}.board-options legend{font-size:14px;font-weight:700;margin-bottom:8px}.board-choice{flex:1;min-width:150px;display:flex;align-items:center;gap:8px;border:1px solid #e0e5e1;border-radius:12px;padding:10px;cursor:pointer}.board-choice:has(input:checked){border-color:#747a77;background:#f0f1f2}.board-choice input{width:16px;min-height:16px;margin:0;accent-color:#343a37}.board-choice .board-identity{display:flex!important;align-items:center}.grid{display:grid;gap:14px}.two{grid-template-columns:repeat(2,minmax(0,1fr))}label{display:grid;gap:6px;font-size:13px;font-weight:600}input,select,textarea{width:100%;min-height:44px;border:1px solid #d8d8d8;border-radius:10px;padding:10px 12px;font:inherit}textarea{min-height:88px;resize:vertical}button{min-height:54px;border:0;border-radius:12px;background:#1769ff;color:#fff;font:600 15px inherit;cursor:pointer}button[disabled]{opacity:.6}.hp{position:absolute;left:-10000px}.message{margin:0;font-size:14px}.error{color:#b42318}.success{color:#16784a}@media(max-width:560px){.two{grid-template-columns:1fr}}</style>' +
    '<form class="box grid"><fieldset class="board-options"><legend>' + t("Board basis") + '</legend>' + ${JSON.stringify(boardChoices)}[language] + '</fieldset><div class="grid two"><label>' + t("Check-in") + '<input required type="date" name="checkIn"></label><label>' + t("Check-out") + '<input required type="date" name="checkOut"></label></div><div class="grid two"><label>' + t("Full name") + '<input required autocomplete="name" name="name" maxlength="160"></label><label>' + t("Email") + '<input type="email" autocomplete="email" name="email"></label></div><div class="grid two"><label>' + t("Phone / WhatsApp") + '<input autocomplete="tel" name="phone"></label><label>' + t("Adults") + '<input required type="number" name="adults" min="1" max="12" value="2"></label></div><label>' + t("Child ages, separated by commas") + '<input name="childAges" placeholder="' + t("e.g. 4, 9") + '"></label><label>' + t("Message") + '<textarea name="note" maxlength="2000"></textarea></label><label class="hp" aria-hidden="true">' + t("Website") + '<input tabindex="-1" autocomplete="off" name="website"></label><button type="submit">' + t("Request availability") + '</button><p class="message" role="status" aria-live="polite"></p></form>';
  const form = root.querySelector("form");
  const message = root.querySelector(".message");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    const data = new FormData(form);
    message.className = "message";
    message.textContent = t("Sending…");
    button.disabled = true;
    try {
      const response = await postInquiry({
        name: data.get("name"), email: data.get("email"), phone: data.get("phone"),
        checkIn: data.get("checkIn"), checkOut: data.get("checkOut"), adults: data.get("adults"),
        childAges: data.get("childAges"), mealPlan: data.get("mealPlan"), note: data.get("note"), website: data.get("website")
      }, "embed");
      if (!response.ok) throw new Error("request_failed");
      form.reset();
      message.className = "message success";
      message.textContent = String(data.get("note") || "").trim() ? t("Request sent. The hotel will review your message before sending an offer.") : t("Request sent. You will receive our offer shortly.");
    } catch (_) {
      message.className = "message error";
      message.textContent = t("Could not send the request. Try again or contact the hotel directly.");
    } finally { button.disabled = false; }
  });
})();`;

export async function registerEmbedRoutes(app: FastifyInstance): Promise<void> {
  app.get("/embed.js", async (_request, reply) =>
    reply
      .header("Cache-Control", "public, max-age=300")
      .header("X-Content-Type-Options", "nosniff")
      .type("application/javascript; charset=utf-8")
      .send(embedScript),
  );
}
