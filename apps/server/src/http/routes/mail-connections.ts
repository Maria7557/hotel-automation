import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError, errors } from "../../lib/errors.js";
import type { AuthService } from "../../services/auth.js";
import type { MailConnectionService } from "../../services/mail-connections.js";
import { requireAuthentication } from "../authenticate.js";
import { detectMailSchema, mailCallbackSchema, smtpConnectSchema, startMailOAuthSchema } from "../mail-schemas.js";
import { oauthFailureStatus, sendOAuthResultPage } from "../oauth-result-page.js";

export async function registerMailConnectionRoutes(app: FastifyInstance, auth: AuthService, mail: MailConnectionService) {
  const authenticate = requireAuthentication(auth);
  const attempts = new Map<string, { count: number; resetAt: number }>();
  const limit = async (request: FastifyRequest) => {
    const key = `${request.ip}:${request.routeOptions.url}`; const now = Date.now(); const current = attempts.get(key);
    if (!current || current.resetAt <= now) { attempts.set(key, { count: 1, resetAt: now + 60_000 }); return; }
    if (current.count >= 10) throw new AppError(429, "RATE_LIMITED", "Too many attempts. Try again shortly."); current.count += 1;
  };
  const protectedConnect = [authenticate, limit];
  const uid = (r: { currentUser: { id: string } | null }) => { if (!r.currentUser) throw errors.unauthorized(); return r.currentUser.id; };
  app.post("/v1/connections/mail/detect", { preHandler: protectedConnect }, async (r) => ({ data: await mail.detect(detectMailSchema.parse(r.body).email) }));
  app.post("/v1/connections/mail/google/oauth/start", { preHandler: protectedConnect }, async (r) => ({ data: await mail.startOAuth(uid(r), "google", startMailOAuthSchema.parse(r.body).email) }));
  app.post("/v1/connections/mail/microsoft/oauth/start", { preHandler: protectedConnect }, async (r) => ({ data: await mail.startOAuth(uid(r), "microsoft", startMailOAuthSchema.parse(r.body).email) }));
  const oauthCallback = (provider: "google" | "microsoft") => async (r: FastifyRequest, reply: FastifyReply) => {
    const providerName = provider === "google" ? "Google" : "Microsoft";
    try {
      const q = mailCallbackSchema.parse(r.query);
      await mail.completeOAuth(provider, q.state, q.code);
      return sendOAuthResultPage(reply, { success: true, provider: providerName });
    } catch (error) {
      return sendOAuthResultPage(reply, {
        success: false,
        provider: providerName,
        statusCode: oauthFailureStatus(error),
      });
    }
  };
  app.get("/v1/connections/mail/google/oauth/callback", { logLevel: "silent", preHandler: limit }, oauthCallback("google"));
  app.get("/v1/connections/mail/microsoft/oauth/callback", { logLevel: "silent", preHandler: limit }, oauthCallback("microsoft"));
  app.post("/v1/connections/mail/smtp", { preHandler: protectedConnect }, async (r) => ({ data: { connection: await mail.connectSmtp(uid(r), smtpConnectSchema.parse(r.body)) } }));
  app.delete("/v1/connections/mail", { preHandler: protectedConnect }, async (r) => ({ data: { connection: await mail.disconnect(uid(r)) } }));
}
