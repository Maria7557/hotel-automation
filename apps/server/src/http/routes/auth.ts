import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveLanguage, translate } from "@hotel/i18n";
import { z } from "zod";

import { AppError, errors } from "../../lib/errors.js";
import type { AuthService } from "../../services/auth.js";
import { requireAuthentication, sessionCookieName } from "../authenticate.js";
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema, socialLoginSchema } from "../schemas.js";
import { authenticatedMonitoringContext } from "../../monitoring/index.js";

export async function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService,
  options: { secure: boolean },
): Promise<void> {
  const authenticate = requireAuthentication(authService);
  const attempts = new Map<string, { count: number; resetAt: number }>();
  const limitRecovery = async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    const now = Date.now();
    // Keep the public endpoint's limiter bounded even when many IPs make requests.
    for (const [key, attempt] of attempts) if (attempt.resetAt <= now) attempts.delete(key);
    const key = `${request.ip}:${request.routeOptions.url}`;
    const current = attempts.get(key);
    const limit = request.routeOptions.url === "/v1/auth/forgot-password" ? 5 : 20;
    if ((current && current.count >= limit) || (!current && attempts.size >= 10_000)) {
      reply.header("Retry-After", String(Math.max(1, Math.ceil(((current?.resetAt ?? now + 60_000) - now) / 1_000))));
      throw new AppError(429, "RATE_LIMITED", "Too many attempts. Try again shortly.");
    }
    attempts.set(key, { count: (current?.count ?? 0) + 1, resetAt: current?.resetAt ?? now + 15 * 60_000 });
  };

  app.post("/v1/auth/forgot-password", { preHandler: limitRecovery }, async (request, reply) => {
    const { email } = forgotPasswordSchema.parse(request.body);
    const language = resolveLanguage(request.headers["accept-language"]?.split(",")[0]);
    authService.requestPasswordReset({ email, language });
    return reply.code(202).send({ data: {
      message: translate(language, "If an account with a password exists for this email, you will receive a reset link shortly."),
    } });
  });

  app.post("/v1/auth/reset-password", { preHandler: limitRecovery }, async (request, reply) => {
    await authService.resetPassword(resetPasswordSchema.parse(request.body));
    reply.clearCookie(sessionCookieName, sessionCookieOptions(options.secure));
    return reply.code(204).send();
  });

  app.post("/v1/auth/register", async (request, reply) => {
    const result = await authService.register(registerSchema.parse(request.body));
    request.currentUser = result.user;
    await authenticatedMonitoringContext(request, result.user);
    setSessionCookie(reply, result, options.secure);
    return reply.code(201).send({ data: serializeAuthResult(result) });
  });

  app.post("/v1/auth/login", async (request, reply) => {
    const result = await authService.login(loginSchema.parse(request.body));
    request.currentUser = result.user;
    await authenticatedMonitoringContext(request, result.user);
    setSessionCookie(reply, result, options.secure);
    return { data: serializeAuthResult(result) };
  });

  app.post("/v1/auth/social", async (request, reply) => {
    const result = await authService.socialLogin(socialLoginSchema.parse(request.body));
    request.currentUser = result.user;
    await authenticatedMonitoringContext(request, result.user);
    setSessionCookie(reply, result, options.secure);
    return { data: serializeAuthResult(result) };
  });

  app.get("/v1/auth/session", { preHandler: authenticate }, async (request) => {
    if (!request.currentUser) throw errors.unauthorized();
    return { data: { user: request.currentUser } };
  });

  app.patch("/v1/auth/preferences", { preHandler: authenticate }, async (request) => {
    const { uiLanguage } = z.object({ uiLanguage: z.enum(["en", "it"]) }).parse(request.body);
    await authService.updateLanguage(request.currentUser!.id, uiLanguage);
    return { data: { uiLanguage } };
  });

  app.post("/v1/auth/logout", { preHandler: authenticate }, async (request, reply) => {
    if (!request.accessToken) throw errors.unauthorized();
    await authService.logout(request.accessToken);
    reply.clearCookie(sessionCookieName, sessionCookieOptions(options.secure));
    return reply.code(204).send();
  });
}

function setSessionCookie(
  reply: FastifyReply,
  result: Awaited<ReturnType<AuthService["login"]>>,
  secure: boolean,
) {
  const maxAge = 365 * 24 * 60 * 60;
  reply.setCookie(sessionCookieName, result.accessToken, {
    ...sessionCookieOptions(secure),
    expires: new Date(Date.now() + maxAge * 1_000),
    maxAge,
  });
}

function sessionCookieOptions(secure: boolean) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
  };
}

function serializeAuthResult(result: Awaited<ReturnType<AuthService["login"]>>) {
  return {
    accessToken: result.accessToken,
    expiresAt: result.expiresAt.toISOString(),
    user: result.user,
  };
}
