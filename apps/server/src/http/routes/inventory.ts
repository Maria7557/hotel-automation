import type { FastifyInstance } from "fastify";

import { errors } from "../../lib/errors.js";
import type { RatePeriodCreate, RatePeriodUpdate, RoomUpdate } from "../../repositories/types.js";
import type { AuthService } from "../../services/auth.js";
import type { InventoryService } from "../../services/inventory.js";
import { requireAuthentication } from "../authenticate.js";
import {
  createRatePeriodSchema,
  createRoomSchema,
  exclusiveToInclusive,
  inclusiveToExclusive,
  previewRateSchema,
  ratePeriodParamsSchema,
  roomParamsSchema,
  updateRatePeriodSchema,
  updateRoomSchema,
} from "../inventory-schemas.js";

export async function registerInventoryRoutes(
  app: FastifyInstance,
  authService: AuthService,
  inventoryService: InventoryService,
): Promise<void> {
  const authenticate = requireAuthentication(authService);

  app.post("/v1/rooms", { preHandler: authenticate }, async (request, reply) => {
    const userId = authenticatedUserId(request.currentUser?.id);
    const room = await inventoryService.createRoom(userId, createRoomSchema.parse(request.body));
    return reply.code(201).send({ data: { room: serializeRoom(room) } });
  });

  app.get("/v1/rooms", { preHandler: authenticate }, async (request) => {
    const rooms = await inventoryService.listRooms(authenticatedUserId(request.currentUser?.id));
    return { data: { rooms: rooms.map(serializeRoom) } };
  });

  app.get("/v1/rooms/:roomId", { preHandler: authenticate }, async (request) => {
    const { roomId } = roomParamsSchema.parse(request.params);
    const room = await inventoryService.getRoom(authenticatedUserId(request.currentUser?.id), roomId);
    return { data: { room: serializeRoom(room) } };
  });

  app.patch("/v1/rooms/:roomId", { preHandler: authenticate }, async (request) => {
    const { roomId } = roomParamsSchema.parse(request.params);
    const parsed = updateRoomSchema.parse(request.body);
    const input = definedEntries(parsed) as RoomUpdate;
    const room = await inventoryService.updateRoom(authenticatedUserId(request.currentUser?.id), roomId, input);
    return { data: { room: serializeRoom(room) } };
  });

  app.delete("/v1/rooms/:roomId", { preHandler: authenticate }, async (request, reply) => {
    const { roomId } = roomParamsSchema.parse(request.params);
    await inventoryService.deleteRoom(authenticatedUserId(request.currentUser?.id), roomId);
    return reply.code(204).send();
  });

  app.post("/v1/rooms/:roomId/rates", { preHandler: authenticate }, async (request, reply) => {
    const { roomId } = roomParamsSchema.parse(request.params);
    const parsed = createRatePeriodSchema.parse(request.body);
    const { endInclusive, ...fields } = parsed;
    const rate = await inventoryService.createRatePeriod(
      authenticatedUserId(request.currentUser?.id),
      roomId,
      { ...fields, endExclusive: inclusiveToExclusive(endInclusive) },
    );
    return reply.code(201).send({ data: { ratePeriod: serializeRatePeriod(rate) } });
  });

  app.get("/v1/rooms/:roomId/rates", { preHandler: authenticate }, async (request) => {
    const { roomId } = roomParamsSchema.parse(request.params);
    const rates = await inventoryService.listRatePeriods(authenticatedUserId(request.currentUser?.id), roomId);
    return { data: { ratePeriods: rates.map(serializeRatePeriod) } };
  });

  app.post("/v1/rooms/:roomId/rates/preview", { preHandler: authenticate }, async (request) => {
    const { roomId } = roomParamsSchema.parse(request.params);
    const input = previewRateSchema.parse(request.body);
    const preview = await inventoryService.preview({
      userId: authenticatedUserId(request.currentUser?.id),
      roomId,
      ...input,
    });
    return { data: { preview } };
  });

  app.get("/v1/rooms/:roomId/rates/:ratePeriodId", { preHandler: authenticate }, async (request) => {
    const { roomId, ratePeriodId } = ratePeriodParamsSchema.parse(request.params);
    const rate = await inventoryService.getRatePeriod(
      authenticatedUserId(request.currentUser?.id),
      roomId,
      ratePeriodId,
    );
    return { data: { ratePeriod: serializeRatePeriod(rate) } };
  });

  app.patch("/v1/rooms/:roomId/rates/:ratePeriodId", { preHandler: authenticate }, async (request) => {
    const { roomId, ratePeriodId } = ratePeriodParamsSchema.parse(request.params);
    const parsed = updateRatePeriodSchema.parse(request.body);
    const { endInclusive, ...rest } = parsed;
    const input = definedEntries({
      ...rest,
      ...(endInclusive === undefined ? {} : { endExclusive: inclusiveToExclusive(endInclusive) }),
    }) as RatePeriodUpdate;
    const rate = await inventoryService.updateRatePeriod(
      authenticatedUserId(request.currentUser?.id),
      roomId,
      ratePeriodId,
      input,
    );
    return { data: { ratePeriod: serializeRatePeriod(rate) } };
  });

  app.delete(
    "/v1/rooms/:roomId/rates/:ratePeriodId",
    { preHandler: authenticate },
    async (request, reply) => {
      const { roomId, ratePeriodId } = ratePeriodParamsSchema.parse(request.params);
      await inventoryService.deleteRatePeriod(
        authenticatedUserId(request.currentUser?.id),
        roomId,
        ratePeriodId,
      );
      return reply.code(204).send();
    },
  );
}

function authenticatedUserId(id: string | undefined): string {
  if (!id) throw errors.unauthorized();
  return id;
}

function definedEntries<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function serializeRoom(room: Awaited<ReturnType<InventoryService["getRoom"]>>) {
  return { ...room, createdAt: room.createdAt.toISOString(), updatedAt: room.updatedAt.toISOString() };
}

function serializeRatePeriod(rate: Awaited<ReturnType<InventoryService["getRatePeriod"]>>) {
  return {
    ...rate,
    endInclusive: exclusiveToInclusive(rate.endExclusive),
    createdAt: rate.createdAt.toISOString(),
    updatedAt: rate.updatedAt.toISOString(),
  };
}
