import { describe, expect, it } from "vitest";
import {
  formatMoney,
  renderEmailHtml,
  renderEmailSubject,
  renderEmailText,
  renderPublicOfferPage,
  renderWhatsAppText,
  type OfferPageState,
  type OfferSnapshot,
} from "../src/index.js";
import { offerSnapshot } from "./fixtures.js";

const messageContext = {
  publicOfferUrl: "https://offers.example.com/o/opaque-token",
  locale: "it-IT",
} as const;

describe("message renderers", () => {
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

  it.each<OfferPageState>(["expired", "accepted", "revoked"])(
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

  it("keeps the guest's selected option visible after acceptance", () => {
    const html = renderPublicOfferPage(offerSnapshot(), {
      state: "accepted",
      acceptActionPath: "/o/opaque-token/accept",
      selectedOptionIndex: 1,
    });
    expect(html).toContain('name="option" value="1" checked disabled');
    expect(html).toContain('name="option" value="0" disabled');
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
