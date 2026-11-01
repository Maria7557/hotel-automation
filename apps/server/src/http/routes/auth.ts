import type { FastifyInstance } from "fastify";

import { errors } from "../../lib/errors.js";
import type { AuthService } from "../../services/auth.js";
import { bearerToken, requireAuthentication } from "../authenticate.js";
import { loginSchema, registerSchema, socialLoginSchema } from "../schemas.js";

export async function registerAuthRoutes(app: FastifyInstance, authService: AuthService): Promise<void> {
  const authenticate = requireAuthentication(authService);

  app.post("/v1/auth/register", async (request, reply) => {
    const result = await authService.register(registerSchema.parse(request.body));
    return reply.code(201).send({ data: serializeAuthResult(result) });
  });

  app.post("/v1/auth/login", async (request) => {
    const result = await authService.login(loginSchema.parse(request.body));
    return { data: serializeAuthResult(result) };
  });

  app.post("/v1/auth/social", async (request) => {
    const result = await authService.socialLogin(socialLoginSchema.parse(request.body));
    return { data: serializeAuthResult(result) };
  });

  app.get("/v1/auth/session", { preHandler: authenticate }, async (request) => {
    if (!request.currentUser) throw errors.unauthorized();
    return { data: { user: request.currentUser } };
  });

  app.post("/v1/auth/logout", { preHandler: authenticate }, async (request, reply) => {
    await authService.logout(request.accessToken ?? bearerToken(request));
    return reply.code(204).send();
  });
}

function serializeAuthResult(result: Awaited<ReturnType<AuthService["login"]>>) {
  return {
    accessToken: result.accessToken,
    expiresAt: result.expiresAt.toISOString(),
    user: result.user,
  };
}
