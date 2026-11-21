import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createMemoryRepositories } from "./helpers/memory-repositories.js";
import { widgetPreviewDocument } from "../../mobile/src/components/widget-preview-document.js";

describe("branded website form CSS", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await createApp({
      env: { AUTH_SECRET: "test-auth-secret-that-is-at-least-32-characters", SESSION_TTL_DAYS: 30, corsOrigins: [] },
      repositories: createMemoryRepositories(),
    });
  });
  afterEach(async () => { await app.close(); });

  async function owner(email: string) {
    const registration = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email, password: "a-secure-test-password" } });
    const headers = { authorization: `Bearer ${registration.json().data.accessToken}` };
    const created = await app.inject({ method: "POST", url: "/v1/hotel", headers, payload: { name: "Branded Hotel", city: "Roma" } });
    expect(created.statusCode, created.body).toBe(201);
    return { headers, publicKey: created.json().data.hotel.publicKey as string };
  }

  it("saves CSS per hotel, preserves it when saving websites, and resets to the default", async () => {
    const first = await owner("brand@example.com");
    const other = await owner("other-brand@example.com");
    const widgetCss = '@import url("https://fonts.example/brand.css");\n:host { --brand: #314d43; }\n.box { border-radius: 0; }\nbutton { background: var(--brand); }';
    const saved = await app.inject({ method: "PUT", url: "/v1/hotel/intake-settings", headers: first.headers, payload: { widgetCss } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().data).toMatchObject({ widgetCss, allowedOrigins: [] });
    const origins = await app.inject({ method: "PUT", url: "/v1/hotel/intake-settings", headers: first.headers, payload: { allowedOrigins: ["https://hotel.example"] } });
    expect(origins.json().data).toMatchObject({ widgetCss, allowedOrigins: ["https://hotel.example"] });
    const reloaded = await app.inject({ method: "GET", url: "/v1/hotel", headers: first.headers });
    expect(reloaded.json().data.hotel.widgetCss).toBe(widgetCss);
    const stylesheet = await app.inject({ method: "GET", url: `/v1/public/hotels/${first.publicKey}/widget.css`, headers: { origin: "https://hotel.example" } });
    expect(stylesheet.statusCode).toBe(200);
    expect(stylesheet.body).toBe(widgetCss);
    expect(stylesheet.headers["content-type"]).toContain("text/css");
    expect(stylesheet.headers["x-content-type-options"]).toBe("nosniff");
    expect(stylesheet.headers["cache-control"]).toBe("no-cache");
    expect(stylesheet.headers["access-control-allow-origin"]).toBe("https://hotel.example");
    const otherStylesheet = await app.inject({ method: "GET", url: `/v1/public/hotels/${other.publicKey}/widget.css` });
    expect(otherStylesheet.body).toBe("");
    const reset = await app.inject({ method: "PUT", url: "/v1/hotel/intake-settings", headers: first.headers, payload: { widgetCss: "" } });
    expect(reset.json().data).toMatchObject({ widgetCss: "", allowedOrigins: ["https://hotel.example"] });
    expect((await app.inject({ method: "GET", url: `/v1/public/hotels/${first.publicKey}/widget.css` })).body).toBe("");
  });

  it("requires authentication to save and validates CSS size and public hotel keys", async () => {
    const hotel = await owner("validated-brand@example.com");
    expect((await app.inject({ method: "PUT", url: "/v1/hotel/intake-settings", payload: { widgetCss: ".box {}" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "PUT", url: "/v1/hotel/intake-settings", headers: hotel.headers, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/v1/hotel/intake-settings", headers: hotel.headers, payload: { widgetCss: "a".repeat(60_001) } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/public/hotels/invalid/widget.css" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/v1/public/hotels/${randomUUID()}/widget.css` })).statusCode).toBe(404);
  });

  it("loads hotel CSS after the default styles inside the widget shadow root", async () => {
    const script = await app.inject({ method: "GET", url: "/embed.js" });
    const widget = widgetEnvironment();
    runInNewContext(script.body, widget.context);
    expect(widget.styles).toHaveLength(1);
    expect(widget.styles[0]).toMatchObject({ tag: "link", rel: "stylesheet", href: `https://api.example/v1/public/hotels/${widget.publicKey}/widget.css` });
    expect(widget.root.innerHTML).toContain('<form class="box grid">');
  });

  it("previews CSS as text, accepts updates only from its parent, and never sends enquiries", async () => {
    const script = await app.inject({ method: "GET", url: "/embed.js" });
    const widget = widgetEnvironment({ preview: "true", previewCss: ".box { color: red; }" });
    runInNewContext(script.body, widget.context);
    expect(widget.styles[0]).toMatchObject({ tag: "style", textContent: ".box { color: red; }" });
    widget.receiveMessage({ source: {}, data: { type: "ospio:preview-css", css: "untrusted" } });
    expect(widget.styles[0]?.textContent).toContain("color: red");
    const css = 'button { color: blue; } /* </style><script>window.attacked=true</script> */';
    widget.receiveMessage({ source: widget.parent, data: { type: "ospio:preview-css", css } });
    expect(widget.styles[0]?.textContent).toBe(css);
    expect(widget.root.innerHTML).not.toContain("window.attacked");
    const preventDefault = vi.fn();
    await widget.submit({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(widget.context.fetch).not.toHaveBeenCalled();
    expect(widget.message.textContent).toBe("Preview only. No enquiry was sent.");
  });

  it("serves a saved preview without putting custom CSS into executable HTML", async () => {
    const hotel = await owner("preview-brand@example.com");
    const css = '/* </style><script>alert("injection")</script> */';
    await app.inject({ method: "PUT", url: "/v1/hotel/intake-settings", headers: hotel.headers, payload: { widgetCss: css } });
    const page = await app.inject({ method: "GET", url: `/v1/public/hotels/${hotel.publicKey}/widget-preview?lang=en` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('data-preview="true"');
    expect(page.body).toContain('data-lang="en"');
    expect(page.body).not.toContain(css);
    expect(page.headers["content-security-policy"]).toContain("form-action 'none'");
    expect(widgetPreviewDocument("https://api.example", '"><script>injection</script>', "en")).not.toContain('<script>injection</script>');
  });
});

function widgetEnvironment(dataset: Record<string, string> = {}) {
  const publicKey = "11111111-1111-4111-8111-111111111111";
  const styles: Array<Record<string, unknown>> = [];
  const message = { textContent: "" };
  let submit: (event: { preventDefault(): void }) => Promise<void> = async () => {};
  let receiveMessage: (event: { source: unknown; data: unknown }) => void = () => {};
  const parent = { postMessage: vi.fn() };
  const form = {
    scrollHeight: 600,
    getBoundingClientRect: () => ({ height: 600 }),
    querySelector: () => ({ addEventListener() {} }),
    addEventListener(name: string, listener: typeof submit) { if (name === "submit") submit = listener; },
  };
  const root = {
    innerHTML: "",
    querySelector: (selector: string) => selector === "form" ? form : selector === ".message" ? message : {},
    appendChild(style: Record<string, unknown>) { styles.push(style); },
  };
  const host = { setAttribute() {}, attachShadow: () => root };
  const context = {
    URL,
    document: {
      currentScript: { src: "https://api.example/embed.js", dataset: { publicKey, lang: "en", ...dataset }, insertAdjacentElement() {} },
      documentElement: { lang: "en" },
      createElement: (tag: string) => tag === "div" ? host : { tag },
    },
    window: { parent, addEventListener(_name: string, listener: typeof receiveMessage) { receiveMessage = listener; } },
    fetch: vi.fn(),
  };
  return { publicKey, styles, root, parent, message, context, receiveMessage: (event: Parameters<typeof receiveMessage>[0]) => receiveMessage(event), submit: (event: Parameters<typeof submit>[0]) => submit(event) };
}
