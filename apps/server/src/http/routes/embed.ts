import type { FastifyInstance } from "fastify";

const embedScript = String.raw`/* Install with: <script async src="https://YOUR_API/embed.js" data-public-key="YOUR_PUBLIC_KEY"></script> */
(() => {
  const script = document.currentScript;
  const publicKey = script && script.dataset.publicKey;
  if (!script || !publicKey || !/^[0-9a-f-]{36}$/i.test(publicKey)) return;
  const apiBase = new URL(script.src).origin;
  const host = document.createElement("div");
  host.setAttribute("data-hotel-inquiry", publicKey);
  script.insertAdjacentElement("afterend", host);
  const root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  root.innerHTML = \
    '<style>*{box-sizing:border-box}.box{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202020;background:#fff;border:1px solid #e5e5e5;border-radius:16px;padding:20px;max-width:680px}.grid{display:grid;gap:14px}.two{grid-template-columns:repeat(2,minmax(0,1fr))}label{display:grid;gap:6px;font-size:13px;font-weight:600}input,textarea{width:100%;min-height:44px;border:1px solid #d8d8d8;border-radius:10px;padding:10px 12px;font:inherit}textarea{min-height:88px;resize:vertical}button{min-height:54px;border:0;border-radius:12px;background:#1769ff;color:#fff;font:600 15px inherit;cursor:pointer}button[disabled]{opacity:.6}.hp{position:absolute;left:-10000px}.message{margin:0;font-size:14px}.error{color:#b42318}.success{color:#16784a}@media(max-width:560px){.two{grid-template-columns:1fr}}</style>' +
    '<form class="box grid"><div class="grid two"><label>Check-in<input required type="date" name="checkIn"></label><label>Check-out<input required type="date" name="checkOut"></label></div><div class="grid two"><label>Full name<input required autocomplete="name" name="name" maxlength="160"></label><label>Email<input type="email" autocomplete="email" name="email"></label></div><div class="grid two"><label>Phone / WhatsApp<input autocomplete="tel" name="phone"></label><label>Adults<input required type="number" name="adults" min="1" max="12" value="2"></label></div><label>Child ages, separated by commas<input name="childAges" placeholder="e.g. 4, 9"></label><label>Message<textarea name="note" maxlength="2000"></textarea></label><label class="hp" aria-hidden="true">Website<input tabindex="-1" autocomplete="off" name="website"></label><button type="submit">Request availability</button><p class="message" role="status" aria-live="polite"></p></form>';
  const form = root.querySelector("form");
  const message = root.querySelector(".message");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    const data = new FormData(form);
    const ages = String(data.get("childAges") || "").split(",").map((v) => v.trim()).filter(Boolean).map(Number);
    message.className = "message";
    message.textContent = "Sending…";
    button.disabled = true;
    try {
      const response = await fetch(apiBase + "/v1/public/hotels/" + encodeURIComponent(publicKey) + "/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random() },
        body: JSON.stringify({
          guest: { name: String(data.get("name") || ""), email: String(data.get("email") || "") || null, phone: String(data.get("phone") || "") || null, language: document.documentElement.lang || "en" },
          checkIn: String(data.get("checkIn") || ""), checkOut: String(data.get("checkOut") || ""),
          occupancy: { adults: Number(data.get("adults") || 1), childAges: ages },
          note: String(data.get("note") || ""), website: String(data.get("website") || ""),
          source: { type: "embed", page: location.origin + location.pathname, widgetVersion: "v1" }
        })
      });
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
