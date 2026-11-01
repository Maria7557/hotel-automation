import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { errors } from "../../lib/errors.js";
import type { PublicUser } from "../../repositories/types.js";
import type { AuthService } from "../../services/auth.js";
import type { PlatformWhatsAppAdminService } from "../../services/platform-whatsapp-admin.js";
import { requireAuthentication } from "../authenticate.js";

const hotelParamsSchema = z.object({ hotelId: z.uuid() });

export async function registerPlatformWhatsAppAdminRoutes(
  app: FastifyInstance,
  authService: AuthService,
  service: PlatformWhatsAppAdminService,
): Promise<void> {
  const authenticate = requireAuthentication(authService);
  const user = (request: { currentUser: PublicUser | null }) => {
    if (!request.currentUser) throw errors.unauthorized();
    return request.currentUser;
  };

  app.get("/v1/platform-admin/access", { preHandler: authenticate }, async (request) => ({
    data: service.access(user(request)),
  }));

  app.get("/v1/platform-admin/whatsapp/sessions", { preHandler: authenticate }, async (request) => ({
    data: await service.list(user(request)),
  }));

  app.post(
    "/v1/platform-admin/whatsapp/hotels/:hotelId/restart",
    { preHandler: authenticate },
    async (request) => {
      const { hotelId } = hotelParamsSchema.parse(request.params);
      return { data: { session: await service.restart(user(request), hotelId) } };
    },
  );
}
