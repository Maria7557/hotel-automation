import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { createMemoryRepositories } from "./helpers/memory-repositories.js";

const testEnv = {
  AUTH_SECRET: "test-auth-secret-that-is-at-least-32-characters",
  SESSION_TTL_DAYS: 30,
  corsOrigins: ["http://localhost:8081"],
};

describe("inventory API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createApp({ env: testEnv, repositories: createMemoryRepositories(), logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("requires authentication and an onboarded hotel", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/rooms" })).statusCode).toBe(401);

    const token = await registeredToken(app, "owner@example.com");
    const response = await app.inject({
      method: "POST",
      url: "/v1/rooms",
      headers: auth(token),
      payload: roomPayload(),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("HOTEL_NOT_FOUND");
  });

  it("creates, lists, updates and soft deletes rooms", async () => {
    const token = await onboardedOwner(app, "owner@example.com", "Casa Blu");
    const created = await createRoom(app, token);
    expect(created.statusCode).toBe(201);
    const room = created.json().data.room;
    expect(room).toMatchObject({
      name: "Camera Deluxe",
      maxAdults: 2,
      maxChildren: 1,
      maxGuests: 3,
      active: true,
    });

    const list = await app.inject({ method: "GET", url: "/v1/rooms", headers: auth(token) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.rooms).toHaveLength(1);

    const update = await app.inject({
      method: "PATCH",
      url: `/v1/rooms/${room.id}`,
      headers: auth(token),
      payload: { description: "Vista sul giardino", amenities: ["wifi", "air_conditioning"] },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().data.room).toMatchObject({
      description: "Vista sul giardino",
      amenities: ["wifi", "air_conditioning"],
    });

    const invalidCapacity = await app.inject({
      method: "PATCH",
      url: `/v1/rooms/${room.id}`,
      headers: auth(token),
      payload: { maxAdults: 4 },
    });
    expect(invalidCapacity.statusCode).toBe(422);
    expect(invalidCapacity.json().error.code).toBe("INVALID_ROOM_CAPACITY");

    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/rooms/${room.id}`,
      headers: auth(token),
    });
    expect(removed.statusCode).toBe(204);
    expect(
      (await app.inject({ method: "GET", url: `/v1/rooms/${room.id}`, headers: auth(token) })).statusCode,
    ).toBe(404);
  });

  it("does not expose another hotel's rooms or rates", async () => {
    const owner = await onboardedOwner(app, "owner@example.com", "Owner Hotel");
    const other = await onboardedOwner(app, "other@example.com", "Other Hotel");
    const roomId = (await createRoom(app, owner)).json().data.room.id as string;

    const roomRead = await app.inject({ method: "GET", url: `/v1/rooms/${roomId}`, headers: auth(other) });
    expect(roomRead.statusCode).toBe(404);

    const rateCreate = await app.inject({
      method: "POST",
      url: `/v1/rooms/${roomId}/rates`,
      headers: auth(other),
      payload: ratePayload("2026-01-01", "2026-01-31", 10_000),
    });
    expect(rateCreate.statusCode).toBe(404);
  });

  it("converts the inclusive UI end date and rejects overlapping active rates with 409", async () => {
    const token = await onboardedOwner(app, "owner@example.com", "Casa Blu");
    const roomId = (await createRoom(app, token)).json().data.room.id as string;

    const january = await createRate(app, token, roomId, ratePayload("2026-01-01", "2026-01-31", 10_000));
    expect(january.statusCode).toBe(201);
    expect(january.json().data.ratePeriod).toMatchObject({
      start: "2026-01-01",
      endInclusive: "2026-01-31",
      endExclusive: "2026-02-01",
    });

    const adjacent = await createRate(app, token, roomId, ratePayload("2026-02-01", "2026-02-28", 12_000));
    expect(adjacent.statusCode).toBe(201);

    const list = await app.inject({
      method: "GET",
      url: `/v1/rooms/${roomId}/rates`,
      headers: auth(token),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.ratePeriods).toHaveLength(2);
    expect(list.json().data.ratePeriods[1]).toMatchObject({
      start: "2026-02-01",
      endInclusive: "2026-02-28",
      endExclusive: "2026-03-01",
    });

    const overlap = await createRate(app, token, roomId, ratePayload("2026-01-15", "2026-02-15", 11_000));
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json().error.code).toBe("RATE_PERIOD_OVERLAP");
    expect(overlap.json().error.details.conflicts).toHaveLength(2);

    const secondId = adjacent.json().data.ratePeriod.id as string;
    const overlappingUpdate = await app.inject({
      method: "PATCH",
      url: `/v1/rooms/${roomId}/rates/${secondId}`,
      headers: auth(token),
      payload: { start: "2026-01-20" },
    });
    expect(overlappingUpdate.statusCode).toBe(409);

    const otherPlan = await createRate(app, token, roomId, {
      ...ratePayload("2026-01-01", "2026-01-31", 9_000),
      planCode: "room_only",
      planName: "Room only",
      mealPlan: "room_only",
    });
    expect(otherPlan.statusCode).toBe(201);
  });

  it("previews a boundary-spanning stay through @hotel/domain", async () => {
    const token = await onboardedOwner(app, "owner@example.com", "Casa Blu");
    const roomId = (await createRoom(app, token)).json().data.room.id as string;
    await createRate(app, token, roomId, ratePayload("2026-01-01", "2026-01-31", 10_000));
    await createRate(app, token, roomId, ratePayload("2026-02-01", "2026-02-28", 12_000));

    const preview = await app.inject({
      method: "POST",
      url: `/v1/rooms/${roomId}/rates/preview`,
      headers: auth(token),
      payload: {
        planCode: "breakfast",
        checkIn: "2026-01-31",
        checkOut: "2026-02-02",
        occupancy: { adults: 2, childAges: [] },
      },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().data.preview).toMatchObject({
      ok: true,
      price: {
        currency: "EUR",
        totalCents: 22_000,
        nights: [
          { date: "2026-01-31", baseCents: 10_000 },
          { date: "2026-02-01", baseCents: 12_000 },
        ],
      },
    });

    const gap = await app.inject({
      method: "POST",
      url: `/v1/rooms/${roomId}/rates/preview`,
      headers: auth(token),
      payload: {
        planCode: "breakfast",
        checkIn: "2026-03-01",
        checkOut: "2026-03-02",
        occupancy: { adults: 2, childAges: [] },
      },
    });
    expect(gap.statusCode).toBe(200);
    expect(gap.json().data.preview).toEqual({
      ok: false,
      issues: [{ type: "gap", date: "2026-03-01" }],
    });

    const tooManyGuests = await app.inject({
      method: "POST",
      url: `/v1/rooms/${roomId}/rates/preview`,
      headers: auth(token),
      payload: {
        planCode: "breakfast",
        checkIn: "2026-01-10",
        checkOut: "2026-01-11",
        occupancy: { adults: 3, childAges: [] },
      },
    });
    expect(tooManyGuests.statusCode).toBe(422);
    expect(tooManyGuests.json().error.code).toBe("ROOM_CAPACITY_EXCEEDED");
  });

  it("reads, updates and deletes a rate period", async () => {
    const token = await onboardedOwner(app, "owner@example.com", "Casa Blu");
    const roomId = (await createRoom(app, token)).json().data.room.id as string;
    const created = await createRate(app, token, roomId, ratePayload("2026-01-01", "2026-01-31", 10_000));
    const rateId = created.json().data.ratePeriod.id as string;

    const read = await app.inject({
      method: "GET",
      url: `/v1/rooms/${roomId}/rates/${rateId}`,
      headers: auth(token),
    });
    expect(read.statusCode).toBe(200);

    const invalidRange = await app.inject({
      method: "PATCH",
      url: `/v1/rooms/${roomId}/rates/${rateId}`,
      headers: auth(token),
      payload: { start: "2026-02-10" },
    });
    expect(invalidRange.statusCode).toBe(422);
    expect(invalidRange.json().error.code).toBe("INVALID_RATE_RANGE");

    const update = await app.inject({
      method: "PATCH",
      url: `/v1/rooms/${roomId}/rates/${rateId}`,
      headers: auth(token),
      payload: { nightlyBaseCents: 10_500, endInclusive: "2026-02-05" },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().data.ratePeriod).toMatchObject({
      nightlyBaseCents: 10_500,
      endInclusive: "2026-02-05",
      endExclusive: "2026-02-06",
    });

    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/rooms/${roomId}/rates/${rateId}`,
      headers: auth(token),
    });
    expect(removed.statusCode).toBe(204);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/rooms/${roomId}/rates/${rateId}`,
          headers: auth(token),
        })
      ).statusCode,
    ).toBe(404);
  });
});

async function registeredToken(app: FastifyInstance, email: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: "a-strong-password", displayName: "Owner" },
  });
  return response.json().data.accessToken as string;
}

async function onboardedOwner(app: FastifyInstance, email: string, hotelName: string): Promise<string> {
  const token = await registeredToken(app, email);
  const hotel = await app.inject({
    method: "POST",
    url: "/v1/hotel",
    headers: auth(token),
    payload: { name: hotelName, city: "Firenze" },
  });
  expect(hotel.statusCode).toBe(201);
  return token;
}

function createRoom(app: FastifyInstance, token: string) {
  return app.inject({
    method: "POST",
    url: "/v1/rooms",
    headers: auth(token),
    payload: roomPayload(),
  });
}

function createRate(app: FastifyInstance, token: string, roomId: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `/v1/rooms/${roomId}/rates`,
    headers: auth(token),
    payload,
  });
}

function roomPayload() {
  return {
    name: "Camera Deluxe",
    description: "Camera matrimoniale",
    maxAdults: 2,
    maxChildren: 1,
    maxGuests: 3,
    beds: [{ type: "king", count: 1 }],
    amenities: ["wifi"],
    photoUrls: ["https://images.example/room.jpg"],
  };
}

function ratePayload(start: string, endInclusive: string, nightlyBaseCents: number) {
  return {
    planCode: "breakfast",
    planName: "Breakfast included",
    mealPlan: "breakfast",
    start,
    endInclusive,
    nightlyBaseCents,
    includedAdults: 2,
    includedChildren: 0,
    extraAdultCents: 3_000,
    extraChildCents: 1_500,
    maxChildAge: 12,
    minNights: 1,
  };
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
