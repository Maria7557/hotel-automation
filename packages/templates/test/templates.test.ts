import { describe, expect, it } from "vitest";
import {
  formatMoney,
  renderEmailHtml,
  renderEmailSubject,
  renderEmailText,
  renderPublicOfferPage,
  renderWhatsAppText,
  renderBoardBadge,
  type OfferPageState,
  type OfferSnapshot,
} from "../src/index.js";
import { offerSnapshot } from "./fixtures.js";

const messageContext = {
  publicOfferUrl: "https://offers.example.com/o/opaque-token",
  locale: "it-IT",
} as const;

describe("message renderers", () => {
  it("defaults guest messages and offer pages to Italian without a locale", () => {
    const snapshot = offerSnapshot();
    const context = { publicOfferUrl: messageContext.publicOfferUrl };
    expect(renderEmailSubject(snapshot, context)).toContain("Proposta di soggiorno");
    expect(renderEmailText(snapshot, context)).toContain("Gentile Anna,");
    expect(renderWhatsAppText(snapshot, context)).toContain("Gentile Anna,");
    expect(renderEmailHtml(snapshot, context)).toContain('<html lang="it">');
    expect(renderPublicOfferPage(snapshot, { state: "active", acceptActionPath: "/o/token/accept" })).toContain('<html lang="it">');
    expect(renderBoardBadge(undefined)).toContain("Trattamento: da confermare");
  });

  it("uses the saved guest language when no rendering locale is supplied", () => {
    const original = offerSnapshot();
    const snapshot = { ...original, guestSnapshot: { ...original.guestSnapshot, language: "en-GB" } };
    const context = { publicOfferUrl: messageContext.publicOfferUrl };
    expect(renderEmailText(snapshot, context)).toContain("Hello Anna,");
    expect(renderWhatsAppText(snapshot, context)).toContain("Hello Anna,");
    expect(renderEmailHtml(snapshot, context)).toContain('<html lang="en">');
    expect(renderPublicOfferPage(snapshot, { state: "active", acceptActionPath: "/o/token/accept" })).toContain('<html lang="en">');
  });

  it.each([["BB", 1], ["HB", 2], ["FB", 3]] as const)("renders %s with a continuous bottom border showing its coverage", (board, filled) => {
    const html = renderBoardBadge(board, "en");
    expect(html).toContain(`data-board="${board}"`);
    expect(html).toContain(`data-coverage="${filled}/3"`);
    expect(html).toContain(`width:${filled / 3 * 100}%`);
    const original = offerSnapshot();
    const snapshot = { ...original, guestSnapshot: { ...original.guestSnapshot, mealPlan: board } };
    expect(renderEmailText(snapshot, messageContext)).toContain(`${board} ·`);
    expect(renderWhatsAppText(snapshot, messageContext)).toContain(`${board} ·`);
  });
  it("renders stable Italian email and WhatsApp output", () => {
    const snapshot = offerSnapshot();
    expect({
      subject: renderEmailSubject(snapshot, messageContext),
      text: renderEmailText(snapshot, messageContext),
      html: renderEmailHtml(snapshot, messageContext),
      whatsapp: renderWhatsAppText(snapshot, messageContext),
    }).toMatchSnapshot();
  });

  it("uses English when requested and as the unknown-locale fallback", () => {
    const snapshot = offerSnapshot();
    expect(
      renderEmailText(snapshot, { ...messageContext, locale: "en-US" }),
    ).toContain("Hello Anna,");
    expect(
      renderEmailText(snapshot, { ...messageContext, locale: "fr-FR" }),
    ).toContain("Hello Anna,");
  });

  it("always formats monetary values as EUR", () => {
    expect(formatMoney(12_345, "it-IT")).toContain("123,45");
    expect(formatMoney(12_345, "it-IT")).toContain("€");
  });

  it("does not mutate a deeply frozen snapshot", () => {
    const freeze = <T>(value: T): T => {
      if (value !== null && typeof value === "object") {
        Object.freeze(value);
        for (const child of Object.values(value)) freeze(child);
      }
      return value;
    };
    const snapshot = freeze(offerSnapshot());
    const before = JSON.stringify(snapshot);
    renderEmailSubject(snapshot, messageContext);
    renderEmailText(snapshot, messageContext);
    renderEmailHtml(snapshot, messageContext);
    renderWhatsAppText(snapshot, messageContext);
    renderPublicOfferPage(snapshot, {
      state: "active",
      acceptActionPath: "/o/opaque-token/accept",
    });
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

describe("public offer page", () => {
  it("links expired reservations back to the hotel booking website", () => {
    const html = renderPublicOfferPage(offerSnapshot(), {
      state: "expired", acceptActionPath: "/o/token/accept", websiteUrl: "https://hotel.example/book?availability=1&new=1", locale: "en",
    });
    expect(html).toContain("This reservation offer has expired");
    expect(html).toContain('href="https://hotel.example/book?availability=1&amp;new=1"');
    expect(html).toContain("Make a new booking &amp; check availability");
    expect(html).not.toContain("<form");
    expect(html).not.toContain('class="option-card"');
  });

  it.each(["javascript:alert(1)", "data:text/html,booking", "https://user:pass@hotel.example"])("does not render unsafe booking links: %s", (websiteUrl) => {
    const html = renderPublicOfferPage(offerSnapshot(), { state: "expired", acceptActionPath: "/o/token/accept", websiteUrl });
    expect(html).not.toContain('class="booking-link"');
  });

  it("includes every offer price and staff note in email and WhatsApp", () => {
    const original = offerSnapshot();
    const snapshot = { ...original, options: Array.from({ length: 6 }, (_, index) => ({ ...original.options[0]!, planName: `Choice ${index + 1}`, totalCents: 20_000 + index * 1_000, note: `Note ${index + 1}` })) };
    for (const text of [renderEmailText(snapshot, { ...messageContext, locale: "en" }), renderEmailHtml(snapshot, { ...messageContext, locale: "en" }), renderWhatsAppText(snapshot, { ...messageContext, locale: "en" })]) {
      for (let index = 0; index < 6; index++) {
        expect(text).toContain(`Choice ${index + 1}`);
        expect(text).toContain(`Note ${index + 1}`);
        expect(text).toContain(formatMoney(20_000 + index * 1_000, "en"));
      }
    }
  });

  it("renders a stable mobile-first active page", () => {
    expect(
      renderPublicOfferPage(offerSnapshot(), {
        state: "active",
        acceptActionPath: "/o/opaque-token/accept",
        locale: "it-IT",
      }),
    ).toMatchSnapshot();
  });

  it("has exactly one POST form and does not put guest PII in its URL", () => {
    const html = renderPublicOfferPage(offerSnapshot(), {
      state: "active",
      acceptActionPath: "/o/opaque-token/accept",
    });
    expect(html.match(/<form\b/g)).toHaveLength(1);
    expect(html).toContain('<form method="post" action="/o/opaque-token/accept"');
    expect(html).not.toContain("anna%40");
    expect(html).not.toContain("Anna/accept");
  });

  it.each<OfferPageState>(["expired", "revoked"])(
    "renders the %s state without an actionable form",
    (state) => {
      const html = renderPublicOfferPage(offerSnapshot(), {
        state,
        acceptActionPath: "/o/opaque-token/accept",
      });
      expect(html).toContain(`class="status ${state}"`);
      expect(html).not.toContain("<form");
      expect(html).not.toContain("<button");
    },
  );

  it("shows a clear final confirmation after acceptance", () => {
    const html = renderPublicOfferPage(offerSnapshot(), {
      state: "accepted",
      acceptActionPath: "/o/opaque-token/accept",
      selectedOptionIndex: 1,
    });
    expect(html).toContain('class="confirmation"');
    expect(html).toContain("Grazie, Anna.");
    expect(html).toContain("Soggiorno");
    expect(html).toContain("Riceverà presto la conferma della prenotazione da Hotel Sole.");
    expect(html).not.toContain("Usually within 15 minutes");
    expect(html).not.toContain("payment link");
    expect(html).not.toContain('class="option-card"');
  });

  it("sets crawler, referrer and content security policies", () => {
    const html = renderPublicOfferPage(offerSnapshot(), {
      state: "active",
      acceptActionPath: "/o/opaque-token/accept",
    });
    expect(html).toContain('name="robots" content="noindex,nofollow,noarchive,nosnippet"');
    expect(html).toContain('name="referrer" content="no-referrer"');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("form-action 'self'");
    expect(html).not.toContain("<script");
  });
});

describe("security boundaries", () => {
  function maliciousSnapshot(): OfferSnapshot {
    const safe = offerSnapshot();
    return {
      ...safe,
      hotelSnapshot: {
        ...safe.hotelSnapshot,
        name: 'Bad\r\nBcc: victim@example.com<script>alert("hotel")</script>',
        logoUrl: "javascript:alert(1)",
      },
      guestSnapshot: {
        ...safe.guestSnapshot,
        name: '<img src=x onerror="alert(guest)">',
      },
      options: [
        {
          ...safe.options[0]!,
          roomName: "<svg onload=alert(1)>",
          roomSnapshot: {
            ...safe.options[0]!.roomSnapshot,
            description: "</span><script>alert(1)</script>",
            photos: [{ url: "data:image/svg+xml,<svg onload=alert(1)>", alt: "x" }],
          },
        },
      ],
    };
  }

  it("escapes every dynamic HTML field and drops unsafe images", () => {
    const snapshot = maliciousSnapshot();
    const email = renderEmailHtml(snapshot, messageContext);
    const page = renderPublicOfferPage(snapshot, {
      state: "active",
      acceptActionPath: "/o/opaque-token/accept",
    });
    for (const html of [email, page]) {
      expect(html).not.toContain("<script>alert");
      expect(html).not.toContain("<svg onload");
      expect(html).not.toContain("javascript:alert");
      expect(html).not.toContain("data:image/svg+xml");
      expect(html).toContain("&lt;");
    }
  });

  it("removes CRLF and control characters from the email subject", () => {
    const subject = renderEmailSubject(maliciousSnapshot(), messageContext);
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toContain("Bcc: victim@example.com");
  });

  it.each([
    "javascript:alert(1)",
    "https://user:pass@offers.example.com/o/token",
    "https://offers.example.com/o/token?email=anna@example.com",
    "https://offers.example.com/o/token#anna",
  ])("rejects an unsafe or PII-prone public offer URL: %s", (publicOfferUrl) => {
    expect(() =>
      renderEmailText(offerSnapshot(), { publicOfferUrl }),
    ).toThrow();
  });

  it.each([
    "https://evil.example/accept",
    "//evil.example/accept",
    "/o/token/accept?email=anna@example.com",
    "/o/token/accept#anna",
  ])("rejects a non-local or PII-prone accept action: %s", (acceptActionPath) => {
    expect(() =>
      renderPublicOfferPage(offerSnapshot(), {
        state: "active",
        acceptActionPath,
      }),
    ).toThrow();
  });
});
