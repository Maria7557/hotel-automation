import { errors } from "../lib/errors.js";
import type { HotelCreate, HotelRepository, HotelUpdate } from "../repositories/types.js";

export class HotelService {
  constructor(private readonly repository: HotelRepository) {}

  async create(userId: string, input: HotelCreate) {
    if (await this.repository.findForUser(userId)) throw errors.hotelExists();
    try {
      return await this.repository.createForUser(userId, input);
    } catch (error) {
      if (error instanceof Error && error.name === "HotelMembershipConflictError") throw errors.hotelExists();
      throw error;
    }
  }

  async get(userId: string) {
    const hotel = await this.repository.findForUser(userId);
    if (!hotel) throw errors.hotelNotFound();
    return hotel;
  }

  async update(userId: string, input: HotelUpdate) {
    const hotel = await this.repository.updateForUser(userId, input);
    if (!hotel) throw errors.hotelNotFound();
    return hotel;
  }

  async updateIntakeSettings(userId: string, allowedOrigins: string[]) {
    const hotel = await this.repository.updateIntakeSettingsForUser(userId, allowedOrigins);
    if (!hotel) throw errors.hotelNotFound();
    return hotel;
  }

  async remove(userId: string): Promise<void> {
    if (!(await this.repository.softDeleteForUser(userId))) throw errors.hotelNotFound();
  }
}
