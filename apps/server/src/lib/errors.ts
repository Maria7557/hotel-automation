export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const errors = {
  unauthorized: () => new AppError(401, "UNAUTHORIZED", "Authentication is required."),
  invalidCredentials: () => new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect."),
  socialTokenInvalid: () =>
    new AppError(401, "SOCIAL_TOKEN_INVALID", "The identity token is invalid or expired."),
  socialEmailUnverified: () =>
    new AppError(401, "SOCIAL_EMAIL_UNVERIFIED", "A verified email address is required."),
  socialAccountConflict: () =>
    new AppError(409, "SOCIAL_ACCOUNT_CONFLICT", "This sign-in identity cannot be linked to the account."),
  socialProviderUnavailable: (provider: string) =>
    new AppError(502, "SOCIAL_PROVIDER_UNAVAILABLE", `${provider} identity verification is unavailable.`),
  emailInUse: () => new AppError(409, "EMAIL_IN_USE", "An account with this email already exists."),
  hotelExists: () => new AppError(409, "HOTEL_EXISTS", "This account already belongs to a hotel."),
  hotelNotFound: () => new AppError(404, "HOTEL_NOT_FOUND", "Hotel profile was not found."),
  roomNotFound: () => new AppError(404, "ROOM_NOT_FOUND", "Room was not found."),
  ratePeriodNotFound: () => new AppError(404, "RATE_PERIOD_NOT_FOUND", "Rate period was not found."),
  rateOverlap: (details?: unknown) =>
    new AppError(409, "RATE_PERIOD_OVERLAP", "This room already has a rate for part of this period.", details),
  invalidRateRange: () =>
    new AppError(422, "INVALID_RATE_RANGE", "The inclusive end date must be on or after the start date."),
  invalidRateOccupancy: () =>
    new AppError(422, "INVALID_RATE_OCCUPANCY", "Included guests exceed the room capacity."),
  invalidRoomCapacity: () =>
    new AppError(422, "INVALID_ROOM_CAPACITY", "Room capacity values are inconsistent."),
  roomCapacityExceeded: () =>
    new AppError(422, "ROOM_CAPACITY_EXCEEDED", "The requested occupancy does not fit this room."),
  publicHotelNotFound: () => new AppError(404, "PUBLIC_HOTEL_NOT_FOUND", "Public hotel form was not found."),
  originNotAllowed: () => new AppError(403, "ORIGIN_NOT_ALLOWED", "This website is not allowed to submit inquiries."),
  idempotencyKeyRequired: () =>
    new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required."),
  offerNotFound: () => new AppError(404, "OFFER_NOT_FOUND", "Offer was not found."),
  offerExpired: () => new AppError(410, "OFFER_EXPIRED", "This offer has expired."),
  offerRevoked: () => new AppError(410, "OFFER_REVOKED", "This offer has been revoked."),
  invalidOfferOption: () =>
    new AppError(422, "INVALID_OFFER_OPTION", "The selected offer option does not exist."),
  configRequired: (provider: string) =>
    new AppError(503, "CONFIG_REQUIRED", `${provider} configuration is required.`),
  oauthStateInvalid: () =>
    new AppError(409, "OAUTH_STATE_INVALID", "OAuth state is invalid, expired, or already used."),
  providerConnectionFailed: (provider: string) =>
    new AppError(502, "PROVIDER_CONNECTION_FAILED", `${provider} connection could not be completed.`),
};
