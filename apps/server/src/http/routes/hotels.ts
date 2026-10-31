import type { FastifyInstance } from "fastify";

import { AppError, errors } from "../../lib/errors.js";
import type { HotelUpdate } from "../../repositories/types.js";
import type { AuthService } from "../../services/auth.js";
import type { HotelService } from "../../services/hotels.js";
import { requireAuthentication } from "../authenticate.js";
import { intakeSettingsSchema } from "../public-schemas.js";
import { createHotelSchema, deleteHotelSchema, updateHotelSchema } from "../schemas.js";

export async function registerHotelRoutes(
  app: FastifyInstance,
  authService: AuthService,
  hotelService: HotelService,
): Promise<void> {
  const authenticate = requireAuthentication(authService);

  app.post("/v1/hotel", { preHandler: authenticate }, async (request, reply) => {
    const user = request.currentUser;
    if (!user) throw errors.unauthorized();
    const hotel = await hotelService.create(user.id, createHotelSchema.parse(request.body));
    return reply.code(201).send({ data: { hotel } });
  });

  app.get("/v1/hotel", { preHandler: authenticate }, async (request) => {
    const user = request.currentUser;
    if (!user) throw errors.unauthorized();
    return { data: { hotel: await hotelService.get(user.id) } };
  });

  app.patch("/v1/hotel", { preHandler: authenticate }, async (request) => {
    const user = request.currentUser;
    if (!user) throw errors.unauthorized();
    const parsed = updateHotelSchema.parse(request.body);
    const update = Object.fromEntries(
      Object.entries(parsed).filter((entry) => entry[1] !== undefined),
    ) as HotelUpdate;
    return { data: { hotel: await hotelService.update(user.id, update) } };
  });

  app.put("/v1/hotel/intake-settings", { preHandler: authenticate }, async (request) => {
    const user = request.currentUser;
    if (!user) throw errors.unauthorized();
    const { allowedOrigins } = intakeSettingsSchema.parse(request.body);
    const hotel = await hotelService.updateIntakeSettings(user.id, allowedOrigins);
    return { data: { publicKey: hotel.publicKey, allowedOrigins: hotel.allowedOrigins } };
  });

  app.delete("/v1/hotel", { preHandler: authenticate }, async (request, reply) => {
    const user = request.currentUser;
    if (!user) throw errors.unauthorized();
    const { confirmName } = deleteHotelSchema.parse(request.body);
    const hotel = await hotelService.get(user.id);
    if (confirmName !== hotel.name) {
      throw new AppError(409, "HOTEL_NAME_MISMATCH", "Hotel name confirmation does not match.");
    }
    await hotelService.remove(user.id);
    return reply.code(204).send();
  });
}
