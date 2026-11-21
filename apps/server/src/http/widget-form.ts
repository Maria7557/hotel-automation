// Runs inside embed.js with the shared translation, API and submission helpers.
export const widgetFormScript = String.raw`
  const host = document.createElement("div");
  host.setAttribute("data-hotel-inquiry", publicKey);
  host.lang = language;
  script.insertAdjacentElement("afterend", host);
  const root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  const languageNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames([language], { type: "language" }) : null;
  const initialGuestLanguage = String(script.dataset.language || script.dataset.lang || "it").toLowerCase().split(/[-_]/)[0];
  const selectedGuestLanguage = guestLanguages.includes(initialGuestLanguage) ? initialGuestLanguage : "it";
  const guestLanguageOptions = guestLanguages.map((value) => { const label = languageNames && languageNames.of(value) || value; return '<option value="' + value + '"' + (value === selectedGuestLanguage ? ' selected' : '') + '>' + label.charAt(0).toLocaleUpperCase(language) + label.slice(1) + '</option>'; }).join("");
  const numberOptions = (min, max, selected) => Array.from({ length: max - min + 1 }, (_, index) => '<option value="' + (min + index) + '"' + (min + index === selected ? ' selected' : '') + '>' + (min + index) + '</option>').join("");
  const roomHtml = (extra) => '<div class="room-fields grid">' + (extra ? '<button class="link remove-room" type="button">− ' + t("Remove room") + '</button>' : '') + '<div class="grid three"><label>' + t("Treatment") + '<select aria-label="' + t("Treatment") + '" required name="mealPlan"><option value="">' + t("Select board basis") + '</option><option value="BB">' + t("BB · Bed and breakfast") + '</option><option value="HB">' + t("HB · Half board") + '</option><option value="FB">' + t("FB · Full board") + '</option></select></label><label>' + t("Adults") + '<select aria-label="' + t("Adults") + '" required name="adults">' + numberOptions(1, 50, 2) + '</select></label><label>' + t("Children") + '<select aria-label="' + t("Children") + '" name="children">' + numberOptions(0, 20, 0) + '</select></label></div><div class="child-fields"></div></div>';
  const dateHtml = (alternative) => '<div class="grid two"><label>' + (alternative ? t("Alternative check-in") : t("Check-in")) + '<input required type="date" name="' + (alternative ? 'altCheckIn' : 'checkIn') + '"></label><label>' + (alternative ? t("Alternative check-out") : t("Check-out")) + '<input required type="date" name="' + (alternative ? 'altCheckOut' : 'checkOut') + '"></label></div>';
  root.innerHTML = '<style>:host{display:block;color-scheme:light}*{box-sizing:border-box}[hidden]{display:none!important}.box{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202020;background:#fff;border:1px solid #e5e5e5;border-radius:16px;padding:20px;max-width:680px;margin:0}.grid{display:grid;gap:16px}.two{grid-template-columns:repeat(2,minmax(0,1fr))}.three{grid-template-columns:repeat(3,minmax(0,1fr))}label{display:grid;align-content:start;gap:8px;min-width:0;font-size:14px;line-height:20px;font-weight:500}input,select,textarea{width:100%;min-width:0;min-height:54px;border:1px solid #c7c7c7;border-radius:12px;padding:12px 16px;background:#fff;color:#202020;font:inherit;font-size:16px;line-height:24px;font-weight:400}input:focus,select:focus,textarea:focus{outline:2px solid #1769ff;outline-offset:1px}textarea{min-height:112px;resize:vertical}button{min-height:54px;border:0;border-radius:12px;padding:12px 16px;background:#1769ff;color:#fff;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer}button[disabled]{opacity:.6}.link{min-height:44px;padding:8px 0;background:transparent;color:#1769ff;text-align:left}.hp{position:absolute!important;left:-10000px!important;width:1px!important;height:1px!important;overflow:hidden!important}.message,.hint{margin:0;font-size:14px;line-height:20px}.hint{font-size:12px;line-height:16px;color:#6f6f6f;margin-bottom:12px}.ages{grid-template-columns:repeat(auto-fit,minmax(120px,1fr))}.consent{display:flex;align-items:center;gap:12px;min-height:44px;font-weight:400}.consent input{width:22px;min-height:22px;height:22px;flex-shrink:0;margin:0;padding:0;accent-color:#1769ff}.privacy-policy{color:#1769ff;font-size:14px}.error{color:#a45255}.success{color:#217a55}@media(max-width:479px){.two,.three{grid-template-columns:1fr}}</style>' +
    '<form class="box grid"><div class="grid two"><label>' + t("First name") + '<input required autocomplete="given-name" name="firstName" maxlength="80" autocapitalize="words"></label><label>' + t("Last name") + '<input required autocomplete="family-name" name="lastName" maxlength="80" autocapitalize="words"></label></div><div class="grid two"><label>' + t("Email") + '<input required type="email" inputmode="email" autocomplete="email" name="email" maxlength="320" autocapitalize="none"></label><label>' + t("Phone / WhatsApp") + '<input required aria-label="' + t("Phone / WhatsApp") + '" type="tel" inputmode="tel" autocomplete="tel" name="phone" maxlength="50"><span class="hint">' + t("Include the country code, e.g. +39.") + '</span></label></div>' + dateHtml(false) + '<div class="alternative-ranges grid"></div><button type="button" class="link add-dates">+ ' + t("Add alternative dates") + '</button><div class="rooms grid">' + roomHtml(false) + '</div><button type="button" class="link add-room">+ ' + t("Add room") + '</button><label>' + t("Message (optional)") + '<textarea name="note" autocomplete="off" maxlength="2000"></textarea></label><label>' + t("Guest language") + '<select aria-label="' + t("Guest language") + '" name="language">' + guestLanguageOptions + '</select></label><label class="consent"><input type="checkbox" name="marketingConsent">' + t("I agree to receive offers and news (optional)") + '</label><label class="consent"><input required type="checkbox" name="privacyConsent">' + t("I consent to the processing of my data") + '</label><a class="privacy-policy" target="_blank" rel="noopener noreferrer">' + t("Privacy Policy") + '</a><label class="hp" aria-hidden="true">' + t("Website") + '<input tabindex="-1" autocomplete="off" name="website"></label><button type="submit">' + t("Request availability") + '</button><p class="message" role="status" aria-live="polite"></p></form>';
  const form = root.querySelector("form");
  const message = root.querySelector(".message");
  const rooms = form.querySelector(".rooms");
  const alternatives = form.querySelector(".alternative-ranges");
  const addRoom = form.querySelector(".add-room");
  const addDates = form.querySelector(".add-dates");
  let privacyUrl = apiBase + "/privacy.html";
  try { const customUrl = new URL(script.dataset.privacyUrl); if (["http:", "https:"].includes(customUrl.protocol)) privacyUrl = customUrl.href; } catch (_) {}
  root.querySelector(".privacy-policy").href = privacyUrl;
  const preview = script.dataset.preview === "true";
  if (signal) signal.bind(root, "Widget");

  // Register only font rules on the document so fonts work inside the Shadow DOM.
  let fontStyle;
  const syncFonts = (sheet) => {
    const fonts = [];
    const collect = (rules) => Array.from(rules || []).forEach((rule) => {
      if (rule.type === 5) fonts.push(rule.cssText);
      else if (rule.styleSheet) { try { collect(rule.styleSheet.cssRules); } catch (_) {} }
      else if (rule.cssRules) collect(rule.cssRules);
    });
    try { collect(sheet && sheet.cssRules); } catch (_) { return; }
    if (!fontStyle && fonts.length) { fontStyle = document.createElement("style"); fontStyle.setAttribute("data-hotel-widget-fonts", publicKey); document.head.appendChild(fontStyle); }
    if (fontStyle) fontStyle.textContent = fonts.join("\n");
  };
  if (preview && script.dataset.previewCss !== undefined) {
    const customStyle = document.createElement("style");
    customStyle.onload = () => syncFonts(customStyle.sheet);
    customStyle.textContent = script.dataset.previewCss;
    root.appendChild(customStyle);
    syncFonts(customStyle.sheet);
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent || !event.data || event.data.type !== "ospio:preview-css" || typeof event.data.css !== "string") return;
      customStyle.textContent = event.data.css;
      syncFonts(customStyle.sheet);
    });
  } else {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.crossOrigin = "anonymous";
    stylesheet.onload = () => syncFonts(stylesheet.sheet);
    stylesheet.href = apiBase + "/v1/public/hotels/" + encodeURIComponent(publicKey) + "/widget.css";
    root.appendChild(stylesheet);
  }
  if (preview) {
    const reportHeight = () => window.parent.postMessage({ type: "ospio:preview-height", height: Math.ceil(Math.max(form.scrollHeight, form.getBoundingClientRect().height)) + 24 }, "*");
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(reportHeight).observe(form);
    window.parent.postMessage({ type: "ospio:preview-ready" }, "*");
    reportHeight();
  }
  const renderChildren = (room) => {
    const childFields = room.querySelector(".child-fields");
    const selected = Array.from(childFields.querySelectorAll("select"), (select) => select.value);
    const count = Number(room.querySelector('[name="children"]').value);
    childFields.innerHTML = count ? '<p class="hint">' + t("Select each child’s age at check-in to calculate the child rate.") + '</p><div class="grid ages">' + Array.from({ length: count }, (_, index) => '<label>' + t("Child {{v0}} age", { v0: index + 1 }) + '<select aria-label="' + t("Child {{v0}} age", { v0: index + 1 }) + '" required name="childAges"><option value="">' + t("Select age") + '</option>' + Array.from({ length: 18 }, (_, age) => '<option value="' + age + '">' + (age === 0 ? t("Under 1 year") : age === 1 ? t("1 year old") : t("{{v0}} years old", { v0: age })) + '</option>').join("") + '</select></label>').join("") + '</div>' : "";
    childFields.querySelectorAll("select").forEach((select, index) => { select.value = selected[index] || ""; });
  };
  rooms.addEventListener("change", (event) => { if (event.target.name === "children") renderChildren(event.target.closest(".room-fields")); });
  rooms.addEventListener("click", (event) => { const button = event.target.closest(".remove-room"); if (button) { button.closest(".room-fields").remove(); addRoom.hidden = false; } });
  addRoom.addEventListener("click", () => { if (rooms.children.length < 6) rooms.insertAdjacentHTML("beforeend", roomHtml(true)); addRoom.hidden = rooms.children.length >= 6; });
  alternatives.addEventListener("click", (event) => { const button = event.target.closest(".remove-dates"); if (button) { button.closest(".alternative-range").remove(); addDates.hidden = false; } });
  addDates.addEventListener("click", () => { if (alternatives.children.length < 3) alternatives.insertAdjacentHTML("beforeend", '<div class="alternative-range grid"><button class="link remove-dates" type="button">− ' + t("Remove alternative dates") + '</button>' + dateHtml(true) + '</div>'); addDates.hidden = alternatives.children.length >= 3; });
  form.addEventListener("reset", () => { rooms.innerHTML = roomHtml(false); alternatives.innerHTML = ""; addRoom.hidden = false; addDates.hidden = false; });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (preview) { message.textContent = t("Preview only. No enquiry was sent."); if (signal) signal.finish(form); return; }
    if (!form.reportValidity()) { if (signal) signal.finish(form, new Error("Validation rejected")); return; }
    const button = form.querySelector('button[type="submit"]');
    const data = new FormData(form);
    const readRoom = (room) => ({ mealPlan: room.querySelector('[name="mealPlan"]').value, occupancy: { adults: Number(room.querySelector('[name="adults"]').value), childAges: Array.from(room.querySelectorAll('[name="childAges"]'), (select) => Number(select.value)) } });
    const selectedRooms = Array.from(rooms.querySelectorAll(".room-fields"), readRoom);
    const alternativeDates = Array.from(alternatives.querySelectorAll(".alternative-range"), (range) => ({ checkIn: range.querySelector('[name="altCheckIn"]').value, checkOut: range.querySelector('[name="altCheckOut"]').value }));
    const details = { firstName: String(data.get("firstName") || ""), lastName: String(data.get("lastName") || ""), alternativeDates, additionalRooms: selectedRooms.slice(1), consents: { privacy: data.has("privacyConsent"), marketing: data.has("marketingConsent") } };
    message.className = "message";
    message.textContent = t("Sending…");
    button.disabled = true;
    try {
      const response = await postInquiry({
        name: [details.firstName.trim(), details.lastName.trim()].filter(Boolean).join(" "), email: data.get("email"), phone: data.get("phone"), language: data.get("language"),
        checkIn: data.get("checkIn"), checkOut: data.get("checkOut"), adults: selectedRooms[0].occupancy.adults,
        childAges: selectedRooms[0].occupancy.childAges, mealPlan: selectedRooms[0].mealPlan, note: data.get("note"), website: data.get("website"), details
      }, "embed", form);
      if (!response.ok) throw new Error("request_failed");
      form.reset();
      message.className = "message success";
      message.textContent = String(data.get("note") || "").trim() || alternativeDates.length || selectedRooms.length > 1 ? t("Request sent. The hotel will review your request before sending an offer.") : t("Request sent. You will receive our offer shortly.");
      if (signal) signal.finish(form);
    } catch (_) { if (signal) signal.finish(form, new Error("Submission failed")); message.className = "message error"; message.textContent = t("Could not send the request. Try again or contact the hotel directly."); }
    finally { button.disabled = false; }
  });
`;
