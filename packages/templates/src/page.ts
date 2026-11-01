import { copyFor, formatGuests, formatMoney, formatStay, languageFor } from "./content.js";
import { escapeHtml, requireAcceptActionPath, safeImageUrl } from "./security.js";
import type { OfferSnapshot, PageRenderContext } from "./types.js";

function statusText(context: PageRenderContext): string {
  const copy = copyFor(context.locale);
  return copy[context.state];
}

function titleCase(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function roomGallery(
  photos: readonly Readonly<{ url: string; alt: string; sortOrder?: number }>[] | undefined,
  roomName: string,
  optionIndex: number,
  locale?: string,
): string {
  const copy = copyFor(locale);
  const safePhotos = [...(photos ?? [])]
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
    .map((photo) => ({ ...photo, safeUrl: safeImageUrl(photo.url) }))
    .filter((photo): photo is typeof photo & { safeUrl: string } => photo.safeUrl !== null)
    .slice(0, 12);

  if (safePhotos.length === 0) return "";

  const photoCount = safePhotos.length;
  const thumbnailLinks = safePhotos
    .map(
      (photo, index) =>
        `<a class="room-thumb${index === 0 ? " is-active" : ""}" href="#photo-${optionIndex}-${index}" aria-label="${escapeHtml(copy.openPhoto(index + 1, photoCount))}"><img src="${escapeHtml(photo.safeUrl)}" alt="${escapeHtml(photo.alt || roomName)}"${index > 0 ? ' loading="lazy"' : ""}></a>`,
    )
    .join("");
  const lightboxes = safePhotos
    .map((photo, index) => {
      const previous = index === 0 ? photoCount - 1 : index - 1;
      const next = index === photoCount - 1 ? 0 : index + 1;
      return `<span class="photo-lightbox" id="photo-${optionIndex}-${index}" role="dialog" aria-modal="true" aria-label="${escapeHtml(copy.openPhoto(index + 1, photoCount))}">
          <a class="photo-backdrop" href="#option-${optionIndex}" aria-label="${escapeHtml(copy.closePhoto)}"></a>
          <span class="photo-stage">
            <img src="${escapeHtml(photo.safeUrl)}" alt="${escapeHtml(photo.alt || roomName)}">
            <span class="photo-toolbar"><strong>${escapeHtml(roomName)}</strong><span>${index + 1} / ${photoCount}</span></span>
            <a class="photo-close" href="#option-${optionIndex}" aria-label="${escapeHtml(copy.closePhoto)}">×</a>
            ${photoCount > 1 ? `<a class="photo-nav photo-prev" href="#photo-${optionIndex}-${previous}" aria-label="${escapeHtml(copy.previousPhoto)}">‹</a><a class="photo-nav photo-next" href="#photo-${optionIndex}-${next}" aria-label="${escapeHtml(copy.nextPhoto)}">›</a>` : ""}
          </span>
        </span>`;
    })
    .join("");

  const hero = safePhotos[0]!;
  return `<span class="room-gallery">
      <a class="room-hero" href="#photo-${optionIndex}-0" aria-label="${escapeHtml(copy.openPhoto(1, photoCount))}"><img src="${escapeHtml(hero.safeUrl)}" alt="${escapeHtml(hero.alt || roomName)}"><span class="gallery-count">${escapeHtml(copy.photos(photoCount))}</span></a>
      <span class="room-thumbnails" aria-label="${escapeHtml(copy.photos(photoCount))}">${thumbnailLinks}</span>
    </span>${lightboxes}`;
}

function stayLength(snapshot: OfferSnapshot): number {
  const checkIn = new Date(`${snapshot.guestSnapshot.checkIn}T00:00:00.000Z`).getTime();
  const checkOut = new Date(`${snapshot.guestSnapshot.checkOut}T00:00:00.000Z`).getTime();
  const nights = (checkOut - checkIn) / 86_400_000;
  if (!Number.isSafeInteger(nights) || nights < 1) throw new Error("Stay must contain at least one night");
  return nights;
}

function roomDetails(option: OfferSnapshot["options"][number], locale?: string): string {
  const copy = copyFor(locale);
  const snapshot = option.roomSnapshot;
  const details: string[] = [];

  if (snapshot?.maxGuests) details.push(copy.upToGuests(snapshot.maxGuests));
  for (const bed of snapshot?.beds ?? []) {
    details.push(`${titleCase(bed.type)} × ${bed.count}`);
  }

  const detailMarkup = details.length
    ? `<span class="room-facts">${details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join("")}</span>`
    : "";
  const amenities = snapshot?.amenities?.length
    ? `<span class="amenities" aria-label="${escapeHtml(copy.amenities)}">${snapshot.amenities.map((amenity) => `<span>${escapeHtml(amenity)}</span>`).join("")}</span>`
    : "";

  return `${detailMarkup}${amenities}`;
}

function optionCards(snapshot: OfferSnapshot, context: PageRenderContext): string {
  const copy = copyFor(context.locale);
  if (snapshot.options.length === 0) return `<p class="empty">${escapeHtml(copy.noOptions)}</p>`;
  const selectedIndex = context.selectedOptionIndex ?? 0;

  return snapshot.options
    .map((option, index) => {
      const gallery = roomGallery(option.roomSnapshot?.photos, option.roomName, index, context.locale);
      const description = option.roomSnapshot?.description;
      const meal = option.mealPlan === "breakfast" ? copy.breakfast : copy.roomOnly;
      return `<article class="option-card" id="option-${index}">
        ${gallery}
        <label class="option-content">
          <span class="option-select"><input type="radio" name="option" value="${index}"${index === selectedIndex ? " checked" : ""}${context.state === "active" ? "" : " disabled"}><span>${escapeHtml(copy.select)}</span></span>
          <strong class="room-name">${escapeHtml(option.roomName)}</strong>
          ${description ? `<span class="description">${escapeHtml(description)}</span>` : ""}
          ${roomDetails(option, context.locale)}
          <span class="plan"><strong>${escapeHtml(meal)}</strong><span>${escapeHtml(option.planName)}</span></span>
          <span class="price"><small>${escapeHtml(copy.perStay)}</small>${escapeHtml(formatMoney(option.totalCents, context.locale))}</span>
        </label>
      </article>`;
    })
    .join("\n");
}

export function renderPublicOfferPage(snapshot: OfferSnapshot, context: PageRenderContext): string {
  const copy = copyFor(context.locale);
  const action = requireAcceptActionPath(context.acceptActionPath);
  const lang = languageFor(context.locale);
  const logoUrl = safeImageUrl(snapshot.hotelSnapshot.logoUrl);
  const cards = optionCards(snapshot, context);
  const formOrCards =
    context.state === "active" && snapshot.options.length > 0
      ? `<form method="post" action="${escapeHtml(action)}" class="offer-form">${cards}<button type="submit">${escapeHtml(copy.accept)}</button></form>`
      : `<div class="offer-list">${cards}</div>`;

  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'">
  <title>${escapeHtml(copy.title(snapshot.hotelSnapshot.name))}</title>
  <style>
    :root{--primary:#1769ff;--primary-tint:#edf3fc;--text:#202020;--muted:#4a4a4a;--line:#e5e5e5;--surface:#fff;--background:#f1f1f1;--warning:#fff1d9;--success:#dceffa;--danger:#fce7e8;--radius:16px}
    *{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--text);font-family:Poppins,Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:16px;line-height:1.5}main{width:min(100%,720px);margin:0 auto;padding:24px 20px 48px}.test-banner{margin:0 0 20px;padding:12px 16px;border-radius:12px;background:var(--warning);font-size:13px;font-weight:700;text-align:center}.brand{display:flex;align-items:center;gap:12px;margin-bottom:32px}.logo{width:48px;height:48px;object-fit:contain;border-radius:12px}.brand-name{font-size:18px;font-weight:600}.eyebrow{margin:0 0 8px;color:var(--primary);font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}h1{margin:0;font-size:28px;line-height:34px}h2{margin:32px 0 16px;font-size:20px;line-height:24px}.summary{display:grid;grid-template-columns:1fr 1fr;gap:16px 12px;margin-top:24px;padding:20px;background:var(--surface);border-radius:var(--radius)}.summary .stay{grid-column:1/-1}.summary div{display:grid;gap:2px}.summary dt{color:var(--muted);font-size:12px}.summary dd{margin:0;font-weight:600}.summary .nights dd{color:var(--primary);font-size:22px;font-weight:800;line-height:1.2}.status{margin:20px 0 0;padding:16px;border-radius:12px;background:var(--primary-tint);font-weight:500}.status.expired{background:var(--warning)}.status.accepted{background:var(--success)}.status.revoked{background:var(--danger)}.offer-form,.offer-list{display:grid;gap:16px}.option-card{display:block;overflow:hidden;background:var(--surface);border:2px solid transparent;border-radius:var(--radius)}.option-card:has(input:checked){border-color:var(--primary)}.room-gallery{display:grid;gap:0;background:var(--surface)}.room-hero{position:relative;display:block;overflow:hidden;background:var(--line)}.room-hero img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;transition:transform .2s ease}.room-hero:hover img{transform:scale(1.02)}.gallery-count{position:absolute;right:12px;bottom:12px;padding:6px 10px;border-radius:999px;background:rgba(20,20,20,.78);color:#fff;font-size:12px;font-weight:700}.room-thumbnails{display:flex;gap:8px;overflow-x:auto;padding:8px;scroll-snap-type:x mandatory;scrollbar-width:thin}.room-thumb{flex:0 0 84px;overflow:hidden;border:2px solid transparent;border-radius:8px;scroll-snap-align:start}.room-thumb.is-active{border-color:var(--primary)}.room-thumb img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover}.photo-lightbox{display:none;position:fixed;z-index:1000;inset:0;place-items:center;padding:16px}.photo-lightbox:target{display:grid}.photo-backdrop{position:absolute;inset:0;background:rgba(10,14,20,.94)}.photo-stage{position:relative;z-index:1;display:grid;width:min(100%,1100px);max-height:calc(100vh - 32px);overflow:hidden;border-radius:14px;background:#101318;box-shadow:0 24px 80px rgba(0,0,0,.5)}.photo-stage>img{display:block;width:100%;max-height:calc(100vh - 96px);object-fit:contain}.photo-toolbar{display:flex;justify-content:space-between;gap:16px;padding:14px 18px;color:#fff;font-size:14px}.photo-close,.photo-nav{position:absolute;display:grid;place-items:center;color:#fff;text-decoration:none;background:rgba(0,0,0,.62);backdrop-filter:blur(6px)}.photo-close{top:12px;right:12px;width:42px;height:42px;border-radius:50%;font-size:28px}.photo-nav{top:50%;width:46px;height:64px;border-radius:10px;font-size:42px;line-height:1;transform:translateY(-50%)}.photo-prev{left:12px}.photo-next{right:12px}.option-content{display:grid;gap:10px;padding:20px;cursor:pointer}.option-select{display:flex;align-items:center;gap:8px;color:var(--primary);font-size:14px;font-weight:600}.option-select input{width:20px;height:20px;accent-color:var(--primary)}.room-name{font-size:20px;line-height:24px}.description{color:var(--muted);font-size:14px}.room-facts,.amenities{display:flex;flex-wrap:wrap;gap:8px}.room-facts span,.amenities span{padding:5px 9px;border-radius:999px;background:#f3f5f7;color:var(--muted);font-size:12px}.amenities span{background:var(--primary-tint);color:#24518b}.plan{display:grid;gap:2px;padding-top:4px;color:var(--muted);font-size:14px}.plan strong{color:var(--text);font-size:14px}.price{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-top:6px;padding-top:14px;border-top:1px solid var(--line);font-size:22px;font-weight:700}.price small{color:var(--muted);font-size:12px;font-weight:400}button{width:100%;min-height:54px;border:0;border-radius:12px;background:var(--primary);color:#fff;font:600 14px Poppins,Inter,sans-serif;cursor:pointer}button:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #202020;outline-offset:3px}.empty{padding:20px;background:var(--surface);border-radius:var(--radius)}@media(min-width:640px){main{padding-top:40px}.summary{grid-template-columns:1.6fr .8fr .6fr;align-items:end}.summary .stay{grid-column:auto}.room-hero img{aspect-ratio:16/9}.room-thumb{flex-basis:104px}}
  </style>
</head>
<body><main>
  ${context.testMode ? `<p class="test-banner">${escapeHtml(copy.testMode)}</p>\n  ` : ""}<header class="brand">${logoUrl ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="">` : ""}<span class="brand-name">${escapeHtml(snapshot.hotelSnapshot.name)}</span></header>
  <p class="eyebrow">${escapeHtml(copy.pageEyebrow)}</p>
  <h1>${escapeHtml(copy.greeting(snapshot.guestSnapshot.name))}</h1>
  <dl class="summary"><div class="stay"><dt>${escapeHtml(copy.stay)}</dt><dd>${escapeHtml(formatStay(snapshot, context.locale))}</dd></div><div><dt>${escapeHtml(copy.guests)}</dt><dd>${escapeHtml(formatGuests(snapshot, context.locale))}</dd></div><div class="nights"><dt>${escapeHtml(copy.lengthOfStay)}</dt><dd>${escapeHtml(copy.nights(stayLength(snapshot)))}</dd></div></dl>
  <p class="status ${context.state}">${escapeHtml(statusText(context))}</p>
  <h2>${escapeHtml(snapshot.hotelSnapshot.name)}</h2>
  ${formOrCards}
</main></body>
</html>`;
}
