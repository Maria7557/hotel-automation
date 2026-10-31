import type { FastifyInstance } from "fastify";

import { errors } from "../../lib/errors.js";
import type { AuthService } from "../../services/auth.js";
import type { ChannelService } from "../../services/channels.js";
import { requireAuthentication } from "../authenticate.js";
import {
  googleCallbackQuerySchema,
  messageSettingsInputSchema,
  previewInputSchema,
  testSendInputSchema,
  wahaConfigurationSchema,
} from "../channel-schemas.js";

export async function registerChannelRoutes(
  app: FastifyInstance,
  authService: AuthService,
  channelService: ChannelService,
): Promise<void> {
  const authenticate = requireAuthentication(authService);
  const userId = (request: { currentUser: { id: string } | null }) => {
    if (!request.currentUser) throw errors.unauthorized();
    return request.currentUser.id;
  };

  app.get("/v1/hotel/message-settings", { preHandler: authenticate }, async (request) => ({
    data: { settings: await channelService.getMessageSettings(userId(request)) },
  }));

  app.put("/v1/hotel/message-settings", { preHandler: authenticate }, async (request) => ({
    data: {
      settings: await channelService.updateMessageSettings(
        userId(request),
        messageSettingsInputSchema.parse(request.body),
      ),
    },
  }));

  app.post("/v1/hotel/message-settings/preview", { preHandler: authenticate }, async (request) => ({
    data: { preview: await channelService.preview(userId(request), previewInputSchema.parse(request.body)) },
  }));

  app.post("/v1/hotel/message-settings/test-send", { preHandler: authenticate }, async (request, reply) =>
    reply.code(202).send({
      data: await channelService.testSend(userId(request), testSendInputSchema.parse(request.body)),
    }),
  );

  app.get("/v1/connections", { preHandler: authenticate }, async (request) => ({
    data: { connections: await channelService.connectionStatuses(userId(request)) },
  }));

  app.get("/v1/connections/waha", { preHandler: authenticate }, async (request) => ({
    data: { connection: await channelService.wahaStatus(userId(request)) },
  }));

  app.put("/v1/connections/waha", { preHandler: authenticate }, async (request) => ({
    data: {
      connection: await channelService.configureWaha(
        userId(request),
        wahaConfigurationSchema.parse(request.body),
      ),
    },
  }));

  app.post("/v1/connections/waha/check", { preHandler: authenticate }, async (request) => ({
    data: { connection: await channelService.checkWaha(userId(request)) },
  }));

  app.get("/v1/connections/google/oauth/start", { preHandler: authenticate }, async (request) => ({
    data: await channelService.startGoogleOAuth(userId(request)),
  }));

  app.get(
    "/v1/connections/google/oauth/callback",
    { logLevel: "silent" },
    async (request, reply) => {
      const { state, code } = googleCallbackQuerySchema.parse(request.query);
      return reply.code(202).send({ data: await channelService.completeGoogleOAuth(state, code) });
    },
  );
}
