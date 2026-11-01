import type { Occupancy, RatePeriod, Room } from "@hotel/contracts";
import { calculateStayPrice, roomFitsOccupancy } from "@hotel/domain";

import { errors } from "../lib/errors.js";
import type {
  InventoryRepository,
  RatePeriodCreate,
  RatePeriodProfile,
  RatePeriodUpdate,
  RoomCreate,
  RoomProfile,
  RoomUpdate,
} from "../repositories/types.js";

export class InventoryService {
  constructor(private readonly repository: InventoryRepository) {}

  async createRoom(userId: string, input: RoomCreate): Promise<RoomProfile> {
    assertRoomCapacity(input);
    const room = await this.repository.createRoomForUser(userId, input);
    if (!room) throw errors.hotelNotFound();
    return room;
  }

  listRooms(userId: string): Promise<RoomProfile[]> {
    return this.repository.listRoomsForUser(userId);
  }

  async getRoom(userId: string, roomId: string): Promise<RoomProfile> {
    const room = await this.repository.findRoomForUser(userId, roomId);
    if (!room) throw errors.roomNotFound();
    return room;
  }

  async updateRoom(userId: string, roomId: string, input: RoomUpdate): Promise<RoomProfile> {
    const current = await this.getRoom(userId, roomId);
    assertRoomCapacity({ ...current, ...input });
    const room = await this.repository.updateRoomForUser(userId, roomId, input);
    if (!room) throw errors.roomNotFound();
    return room;
  }

  async deleteRoom(userId: string, roomId: string): Promise<void> {
    if (!(await this.repository.softDeleteRoomForUser(userId, roomId))) throw errors.roomNotFound();
  }

  async createRatePeriod(
    userId: string,
    roomId: string,
    input: RatePeriodCreate,
  ): Promise<RatePeriodProfile> {
    const room = await this.getRoom(userId, roomId);
    assertRateOccupancy(room, input);
    if (input.active) await this.assertNoRateOverlap(userId, roomId, input);
    try {
      const rate = await this.repository.createRatePeriodForUser(userId, roomId, input);
      if (!rate) throw errors.roomNotFound();
      return rate;
    } catch (error) {
      if (isRateOverlapError(error)) throw errors.rateOverlap();
      throw error;
    }
  }

  async listRatePeriods(userId: string, roomId: string): Promise<RatePeriodProfile[]> {
    const rates = await this.repository.listRatePeriodsForUser(userId, roomId);
    if (!rates) throw errors.roomNotFound();
    return rates;
  }

  async getRatePeriod(userId: string, roomId: string, ratePeriodId: string): Promise<RatePeriodProfile> {
    const rate = await this.repository.findRatePeriodForUser(userId, roomId, ratePeriodId);
    if (!rate) throw errors.ratePeriodNotFound();
    return rate;
  }

  async updateRatePeriod(
    userId: string,
    roomId: string,
    ratePeriodId: string,
    input: RatePeriodUpdate,
  ): Promise<RatePeriodProfile> {
    const current = await this.getRatePeriod(userId, roomId, ratePeriodId);
    const next = { ...current, ...input };
    const room = await this.getRoom(userId, roomId);
    assertRateOccupancy(room, next);
    if (next.start >= next.endExclusive) {
      throw errors.invalidRateRange();
    }
    if (next.active) {
      await this.assertNoRateOverlap(userId, roomId, next, ratePeriodId);
    }
    try {
      const rate = await this.repository.updateRatePeriodForUser(userId, roomId, ratePeriodId, input);
      if (!rate) throw errors.ratePeriodNotFound();
      return rate;
    } catch (error) {
      if (isRateOverlapError(error)) throw errors.rateOverlap();
      throw error;
    }
  }

  async deleteRatePeriod(userId: string, roomId: string, ratePeriodId: string): Promise<void> {
    if (!(await this.repository.softDeleteRatePeriodForUser(userId, roomId, ratePeriodId))) {
      throw errors.ratePeriodNotFound();
    }
  }

  async preview(input: {
    userId: string;
    roomId: string;
    planCode: string;
    checkIn: string;
    checkOut: string;
    occupancy: Occupancy;
  }) {
    const room = await this.getRoom(input.userId, input.roomId);
    if (!roomFitsOccupancy(toDomainRoom(room), input.occupancy)) throw errors.roomCapacityExceeded();
    const rates = await this.listRatePeriods(input.userId, input.roomId);
    return calculateStayPrice({
      roomId: room.id,
      planCode: input.planCode,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      occupancy: input.occupancy,
      periods: rates.map(toDomainRatePeriod),
    });
  }

  private async assertNoRateOverlap(
    userId: string,
    roomId: string,
    input: Pick<RatePeriodCreate, "planCode" | "start" | "endExclusive">,
    excludeRatePeriodId?: string,
  ): Promise<void> {
    const overlaps = await this.repository.findRateOverlapsForUser({
      userId,
      roomId,
      planCode: input.planCode,
      start: input.start,
      endExclusive: input.endExclusive,
      ...(excludeRatePeriodId ? { excludeRatePeriodId } : {}),
    });
    if (overlaps === null) throw errors.roomNotFound();
    if (overlaps.length > 0) throw errors.rateOverlap({ conflicts: overlaps });
  }
}

function assertRoomCapacity(input: Pick<RoomCreate, "maxAdults" | "maxChildren" | "maxGuests">): void {
  if (input.maxGuests < input.maxAdults || input.maxGuests > input.maxAdults + input.maxChildren) {
    throw errors.invalidRoomCapacity();
  }
}

function assertRateOccupancy(
  room: Pick<RoomProfile, "maxAdults" | "maxChildren" | "maxGuests">,
  rate: Pick<RatePeriodCreate, "includedAdults" | "includedChildren">,
): void {
  if (
    rate.includedAdults > room.maxAdults ||
    rate.includedChildren > room.maxChildren ||
    rate.includedAdults + rate.includedChildren > room.maxGuests
  ) {
    throw errors.invalidRateOccupancy();
  }
}

function isRateOverlapError(error: unknown): boolean {
  return error instanceof Error && error.name === "RateOverlapConflictError";
}

function toDomainRoom(room: RoomProfile): Room {
  return {
    id: room.id,
    hotelId: room.hotelId,
    name: room.name,
    description: room.description ?? "",
    maxAdults: room.maxAdults,
    maxChildren: room.maxChildren,
    maxGuests: room.maxGuests,
    beds: room.beds,
    amenities: room.amenities,
    photos: room.photoUrls.map((url, sortOrder) => ({ url, alt: room.name, sortOrder })),
    active: room.active,
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
  };
}

function toDomainRatePeriod(rate: RatePeriodProfile): RatePeriod {
  return {
    id: rate.id,
    hotelId: rate.hotelId,
    roomId: rate.roomId,
    planCode: rate.planCode,
    planName: rate.planName,
    start: rate.start,
    endExclusive: rate.endExclusive,
    nightlyBaseCents: rate.nightlyBaseCents,
    currency: rate.currency,
    mealPlan: rate.mealPlan,
    includedAdults: rate.includedAdults,
    includedChildren: rate.includedChildren,
    extraAdultCents: rate.extraAdultCents,
    extraChildCents: rate.extraChildCents,
    breakfastAdultCents: rate.breakfastAdultCents,
    breakfastChildCents: rate.breakfastChildCents,
    maxChildAge: rate.maxChildAge,
    minNights: rate.minNights,
    active: rate.active,
    createdAt: rate.createdAt.toISOString(),
    updatedAt: rate.updatedAt.toISOString(),
  };
}
