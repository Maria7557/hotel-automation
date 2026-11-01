import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { errors } from "../../lib/errors.js";
import type { AuthService } from "../../services/auth.js";
import type { NotificationService } from "../../services/notifications.js";
import { requireAuthentication } from "../authenticate.js";

const settingsSchema = z.object({
  pushAllRequests: z.boolean(),
  emailIncomingRequests: z.boolean(),
  emailAddress: z.union([z.email().max(320), z.null()]),
}).superRefine((value, context) => {
  if (value.emailIncomingRequests && !value.emailAddress) {
    context.addIssue({ code: "custom", path: ["emailAddress"], message: "Email address is required." });
  }
});

const deviceSchema = z.object({
  expoPushToken: z.string().regex(/^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]+\]$/).max(255),
  platform: z.enum(["ios", "android"]),
  deviceName: z.string().trim().min(1).max(120).nullable(),
});

const unregisterSchema = z.object({ expoPushToken: deviceSchema.shape.expoPushToken });

export async function registerNotificationRoutes(
  app: FastifyInstance,
  authService: AuthService,
  notificationService: NotificationService,
): Promise<void> {
  const authenticate = requireAuthentication(authService);

  app.get("/v1/notifications/settings", { preHandler: authenticate }, async (request) => {
    if (!request.currentUser) throw errors.unauthorized();
    const settings = await notificationService.settings(request.currentUser.id);
    if (!settings) throw errors.unauthorized();
    return { data: { settings } };
  });

  app.put("/v1/notifications/settings", { preHandler: authenticate }, async (request) => {
    if (!request.currentUser) throw errors.unauthorized();
    const settings = await notificationService.updateSettings(request.currentUser.id, settingsSchema.parse(request.body));
    if (!settings) throw errors.unauthorized();
    return { data: { settings } };
  });

  app.post("/v1/notifications/devices", { preHandler: authenticate }, async (request, reply) => {
    if (!request.currentUser) throw errors.unauthorized();
    const settings = await notificationService.registerDevice(request.currentUser.id, deviceSchema.parse(request.body));
    if (!settings) throw errors.unauthorized();
    return reply.code(201).send({ data: { settings } });
  });

  app.delete("/v1/notifications/devices", { preHandler: authenticate }, async (request) => {
    if (!request.currentUser) throw errors.unauthorized();
    const { expoPushToken } = unregisterSchema.parse(request.body);
    const settings = await notificationService.unregisterDevice(request.currentUser.id, expoPushToken);
    if (!settings) throw errors.unauthorized();
    return { data: { settings } };
  });
}
