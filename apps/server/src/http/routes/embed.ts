import type { FastifyInstance } from "fastify";

const embedScript = String.raw`/*
Widget: <script async src="https://YOUR_API/embed.js" data-public-key="YOUR_PUBLIC_KEY"></script>
Existing form adapter: <script async src="https://YOUR_API/embed.js" data-public-key="YOUR_PUBLIC_KEY" data-mode="adapter" data-form="#booking-form"></script>
Tag fields with data-hotel-field="checkIn|checkOut|name|email|phone|adults|childAges|note".
Alternatively map them on the script with data-check-in, data-check-out, data-name, data-email,
data-phone, data-adults, data-child-ages and data-note CSS selectors.
*/
(() => {
  const script = document.currentScript;
  const publicKey = script && script.dataset.publicKey;
  if (!script || !publicKey || !/^[0-9a-f-]{36}$/i.test(publicKey)) return;
  const apiBase = new URL(script.src).origin;

  const postInquiry = async (values, sourceType) => {
    const ages = String(values.childAges || "").split(",").map((value) => value.trim()).filter(Boolean).map(Number);
    return fetch(apiBase + "/v1/public/hotels/" + encodeURIComponent(publicKey) + "/inquiries", {
      method: "POST",
      keepalive: sourceType === "existing_form",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random() },
      body: JSON.stringify({
        guest: { name: String(values.name || ""), email: String(values.email || "") || null, phone: String(values.phone || "") || null, language: document.documentElement.lang || "en" },
        checkIn: String(values.checkIn || ""), checkOut: String(values.checkOut || ""),
        occupancy: { adults: Number(values.adults || 1), childAges: ages },
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
      adults: script.dataset.adults,
      childAges: script.dataset.childAges,
      note: script.dataset.note,
      website: script.dataset.website
    };
    const read = (field) => {
      const selector = fieldSelectors[field] || '[data-hotel-field="' + field + '"]';
      let element;
      try { element = form.querySelector(selector); } catch (_) { return ""; }
      if (!element) return "";
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
      setStatus("sending", "Sending…");
      try {
        const response = await postInquiry({
          checkIn: read("checkIn"), checkOut: read("checkOut"), name: read("name"),
          email: read("email"), phone: read("phone"), adults: read("adults") || 1,
          childAges: read("childAges"), note: read("note"), website: read("website")
        }, "existing_form");
        if (!response.ok) throw new Error("request_failed");
        setStatus("success", "Request sent. You will receive our offer shortly.");
      } catch (_) {
        setStatus("error", "Could not send the request. Try again or contact the hotel directly.");
      } finally {
        if (replaceOriginal) submitters.forEach((element) => { element.disabled = false; });
      }
    }, { capture: true });
    return;
  }

  const host = document.createElement("div");
  host.setAttribute("data-hotel-inquiry", publicKey);
  script.insertAdjacentElement("afterend", host);
  const root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  root.innerHTML =
    '<style>*{box-sizing:border-box}.box{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202020;background:#fff;border:1px solid #e5e5e5;border-radius:16px;padding:20px;max-width:680px}.grid{display:grid;gap:14px}.two{grid-template-columns:repeat(2,minmax(0,1fr))}label{display:grid;gap:6px;font-size:13px;font-weight:600}input,textarea{width:100%;min-height:44px;border:1px solid #d8d8d8;border-radius:10px;padding:10px 12px;font:inherit}textarea{min-height:88px;resize:vertical}button{min-height:54px;border:0;border-radius:12px;background:#1769ff;color:#fff;font:600 15px inherit;cursor:pointer}button[disabled]{opacity:.6}.hp{position:absolute;left:-10000px}.message{margin:0;font-size:14px}.error{color:#b42318}.success{color:#16784a}@media(max-width:560px){.two{grid-template-columns:1fr}}</style>' +
    '<form class="box grid"><div class="grid two"><label>Check-in<input required type="date" name="checkIn"></label><label>Check-out<input required type="date" name="checkOut"></label></div><div class="grid two"><label>Full name<input required autocomplete="name" name="name" maxlength="160"></label><label>Email<input type="email" autocomplete="email" name="email"></label></div><div class="grid two"><label>Phone / WhatsApp<input autocomplete="tel" name="phone"></label><label>Adults<input required type="number" name="adults" min="1" max="12" value="2"></label></div><label>Child ages, separated by commas<input name="childAges" placeholder="e.g. 4, 9"></label><label>Message<textarea name="note" maxlength="2000"></textarea></label><label class="hp" aria-hidden="true">Website<input tabindex="-1" autocomplete="off" name="website"></label><button type="submit">Request availability</button><p class="message" role="status" aria-live="polite"></p></form>';
  const form = root.querySelector("form");
  const message = root.querySelector(".message");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    const data = new FormData(form);
    message.className = "message";
    message.textContent = "Sending…";
    button.disabled = true;
    try {
      const response = await postInquiry({
        name: data.get("name"), email: data.get("email"), phone: data.get("phone"),
        checkIn: data.get("checkIn"), checkOut: data.get("checkOut"), adults: data.get("adults"),
        childAges: data.get("childAges"), note: data.get("note"), website: data.get("website")
      }, "embed");
      if (!response.ok) throw new Error("request_failed");
      form.reset();
      message.className = "message success";
      message.textContent = "Request sent. You will receive our offer shortly.";
    } catch (_) {
      message.className = "message error";
      message.textContent = "Could not send the request. Try again or contact the hotel directly.";
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
