import type { FastifyInstance, FastifyReply } from "fastify";

import { errors } from "../../lib/errors.js";
import type { AuthService } from "../../services/auth.js";
import { requireAuthentication, sessionCookieName } from "../authenticate.js";
import { loginSchema, registerSchema, socialLoginSchema } from "../schemas.js";

export async function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService,
  options: { secure: boolean },
): Promise<void> {
  const authenticate = requireAuthentication(authService);

  app.post("/v1/auth/register", async (request, reply) => {
    const result = await authService.register(registerSchema.parse(request.body));
    setSessionCookie(reply, result, options.secure);
    return reply.code(201).send({ data: serializeAuthResult(result) });
  });

  app.post("/v1/auth/login", async (request, reply) => {
    const result = await authService.login(loginSchema.parse(request.body));
    setSessionCookie(reply, result, options.secure);
    return { data: serializeAuthResult(result) };
  });

  app.post("/v1/auth/social", async (request, reply) => {
    const result = await authService.socialLogin(socialLoginSchema.parse(request.body));
    setSessionCookie(reply, result, options.secure);
    return { data: serializeAuthResult(result) };
  });

  app.get("/v1/auth/session", { preHandler: authenticate }, async (request) => {
    if (!request.currentUser) throw errors.unauthorized();
    return { data: { user: request.currentUser } };
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
