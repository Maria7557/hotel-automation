import type { FastifyReply } from "fastify";
import { ZodError } from "zod";

import { AppError } from "../lib/errors.js";

type OAuthResult = {
  success: boolean;
  provider: "Google" | "Microsoft";
  statusCode?: number;
};

export function sendOAuthResultPage(reply: FastifyReply, result: OAuthResult) {
  reply
    .header("Cache-Control", "no-store")
    .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'")
    .type("text/html; charset=utf-8")
    .code(result.statusCode ?? (result.success ? 200 : 400));

  return reply.send(renderOAuthResultPage(result));
}

export function oauthFailureStatus(error: unknown): number {
  if (error instanceof AppError) return error.statusCode;
  if (error instanceof ZodError) return 400;
  return 500;
}

function renderOAuthResultPage({ success, provider }: OAuthResult): string {
  const title = success ? "Mail connected" : "Connection unsuccessful";
  const description = success
    ? `${provider} Mail is ready. You can now send offers from your connected address.`
    : `We could not connect ${provider} Mail. Return to Connections and try again.`;
  const icon = success
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5m0 3h.01"/><circle cx="12" cy="12" r="9"/></svg>';
  const automaticReturn = success
    ? '<meta http-equiv="refresh" content="5;url=/">'
    : "";
  const note = success
    ? "Returning to Hotel in a few seconds…"
    : "If the problem continues, contact support and we’ll help you connect it.";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${automaticReturn}
  <title>${title} · Hotel</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; color: #17191c; background: #f7f8fb; }
    main { width: min(100%, 520px); padding: 42px; text-align: center; background: #fff; border: 1px solid #e2e5ea; border-radius: 24px; box-shadow: 0 18px 55px rgba(25, 43, 78, .10); }
    .mark { width: 72px; height: 72px; display: grid; place-items: center; margin: 0 auto 24px; border-radius: 22px; color: ${success ? "#168a52" : "#b42318"}; background: ${success ? "#e8f8ef" : "#ffebea"}; }
    svg { width: 38px; height: 38px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .eyebrow { margin: 0 0 10px; color: #1769ff; font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(30px, 6vw, 40px); line-height: 1.08; letter-spacing: -.035em; }
    .description { margin: 16px auto 28px; max-width: 390px; color: #616773; font-size: 16px; line-height: 1.55; }
    a { min-height: 50px; display: inline-flex; align-items: center; justify-content: center; padding: 0 24px; color: #fff; background: #1769ff; border-radius: 12px; font-size: 15px; font-weight: 700; text-decoration: none; }
    .note { margin: 18px 0 0; color: #858b96; font-size: 13px; line-height: 1.45; }
    @media (max-width: 560px) { main { padding: 32px 22px; border-radius: 20px; } }
  </style>
</head>
<body>
  <main>
    <div class="mark">${icon}</div>
    <p class="eyebrow">Hotel · Connections</p>
    <h1>${title}</h1>
    <p class="description">${description}</p>
    <a href="/">Back to Hotel</a>
    <p class="note">${note}</p>
  </main>
</body>
</html>`;
}
