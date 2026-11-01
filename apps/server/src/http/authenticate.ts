import type { FastifyReply, FastifyRequest } from "fastify";

import { errors } from "../lib/errors.js";
import type { PublicUser } from "../repositories/types.js";
import type { AuthService } from "../services/auth.js";

export const sessionCookieName = "hotel_session";

declare module "fastify" {
  interface FastifyRequest {
    currentUser: PublicUser | null;
    accessToken: string | null;
  }
}

export function bearerToken(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  if (!authorization) throw errors.unauthorized();
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) throw errors.unauthorized();
  return token;
}

export function sessionToken(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  if (authorization) return bearerToken(request);
  const token = request.cookies[sessionCookieName];
  if (!token) throw errors.unauthorized();
  return token;
}

export function requireAuthentication(authService: AuthService) {
  return async function authenticateRequest(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const token = sessionToken(request);
    request.currentUser = await authService.authenticate(token);
    request.accessToken = token;
  };
}
