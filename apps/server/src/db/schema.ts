import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const memberRole = pgEnum("member_role", ["owner", "staff"]);
export const connectionKind = pgEnum("connection_kind", ["google", "microsoft", "smtp", "waha"]);
export const connectionState = pgEnum("connection_state", [
  "disconnected",
  "connecting",
  "connected",
  "attention",
]);
export const offerState = pgEnum("offer_state", ["active", "accepted", "expired", "revoked"]);
export const deliveryChannel = pgEnum("delivery_channel", ["email", "whatsapp", "push"]);
export const deliveryState = pgEnum("delivery_state", [
  "scheduled",
  "processing",
  "provider_accepted",
  "delivered",
  "failed",
  "unknown",
  "cancelled",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 320 }).notNull(),
    displayName: varchar("display_name", { length: 120 }),
    passwordHash: text("password_hash"),
    googleSubject: varchar("google_subject", { length: 255 }),
    appleSubject: varchar("apple_subject", { length: 255 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_email_lower_unique").on(table.email),
    uniqueIndex("users_google_subject_unique").on(table.googleSubject),
    uniqueIndex("users_apple_subject_unique").on(table.appleSubject),
  ],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_sessions_token_hash_unique").on(table.tokenHash),
    index("auth_sessions_user_idx").on(table.userId),
    index("auth_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const hotels = pgTable("hotels", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicKey: uuid("public_key").notNull().defaultRandom().unique(),
  allowedOrigins: jsonb("allowed_origins").$type<string[]>().notNull().default([]),
  name: varchar("name", { length: 120 }).notNull(),
  city: varchar("city", { length: 120 }).notNull(),
  countryCode: varchar("country_code", { length: 2 }).notNull().default("IT"),
  locale: varchar("locale", { length: 16 }).notNull().default("en-GB"),
  description: text("description"),
  currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
  timezone: varchar("timezone", { length: 64 }).notNull().default("Europe/Rome"),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 50 }),
  website: text("website"),
  logoUrl: text("logo_url"),
  photoUrls: jsonb("photo_urls").$type<string[]>().notNull().default([]),
  termsText: text("terms_text"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
});

export const hotelMessageSettings = pgTable("hotel_message_settings", {
  hotelId: uuid("hotel_id")
    .primaryKey()
    .references(() => hotels.id, { onDelete: "cascade" }),
  emailSubjectTemplate: varchar("email_subject_template", { length: 160 }).notNull(),
  emailBodyTemplate: text("email_body_template").notNull(),
  whatsappBodyTemplate: text("whatsapp_body_template").notNull(),
  ...timestamps,
});

export const hotelMembers = pgTable(
  "hotel_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hotelId: uuid("hotel_id")
      .notNull()
      .references(() => hotels.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("staff"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("hotel_members_hotel_user_unique").on(table.hotelId, table.userId),
    index("hotel_members_user_idx").on(table.userId),
  ],
);

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  pushAllRequests: boolean("push_all_requests").notNull().default(false),
  emailIncomingRequests: boolean("email_incoming_requests").notNull().default(false),
  emailAddress: varchar("email_address", { length: 320 }),
  ...timestamps,
});

export const pushDevices = pgTable(
  "push_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expoPushToken: varchar("expo_push_token", { length: 255 }).notNull(),
    platform: varchar("platform", { length: 20 }).notNull(),
    deviceName: varchar("device_name", { length: 120 }),
    active: boolean("active").notNull().default(true),
    lastRegisteredAt: timestamp("last_registered_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("push_devices_token_unique").on(table.expoPushToken),
    index("push_devices_user_idx").on(table.userId),
  ],
);

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hotelId: uuid("hotel_id")
      .notNull()
      .references(() => hotels.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    maxAdults: integer("max_adults").notNull(),
    maxChildren: integer("max_children").notNull().default(0),
    maxGuests: integer("max_guests").notNull(),
    beds: jsonb("beds").$type<Array<{ type: string; count: number }>>().notNull().default([]),
    amenities: jsonb("amenities").$type<string[]>().notNull().default([]),
    photoUrls: jsonb("photo_urls").$type<string[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("rooms_hotel_idx").on(table.hotelId)],
);

export const ratePeriods = pgTable(
  "rate_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    planKey: varchar("plan_key", { length: 40 }).notNull(),
    planName: varchar("plan_name", { length: 120 }).notNull(),
    mealPlan: varchar("meal_plan", { length: 40 }).notNull().default("room_only"),
    startDate: date("start_date").notNull(),
    endDateExclusive: date("end_date_exclusive").notNull(),
    nightlyPriceCents: integer("nightly_price_cents").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
    includedAdults: integer("included_adults").notNull().default(2),
    includedChildren: integer("included_children").notNull().default(0),
    extraAdultCents: integer("extra_adult_cents").notNull().default(0),
    extraChildCents: integer("extra_child_cents").notNull().default(0),
    breakfastAdultCents: integer("breakfast_adult_cents").notNull().default(0),
    breakfastChildCents: integer("breakfast_child_cents").notNull().default(0),
    childMaxAge: integer("child_max_age").notNull().default(17),
    minimumNights: integer("minimum_nights").notNull().default(1),
    active: boolean("active").notNull().default(true),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("rate_periods_room_idx").on(table.roomId)],
);

export const inquiries = pgTable(
  "inquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hotelId: uuid("hotel_id")
      .notNull()
      .references(() => hotels.id, { onDelete: "cascade" }),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    guestName: varchar("guest_name", { length: 160 }).notNull(),
    guestEmail: varchar("guest_email", { length: 320 }),
    guestPhone: varchar("guest_phone", { length: 50 }),
    locale: varchar("locale", { length: 16 }).notNull().default("it"),
    checkIn: date("check_in").notNull(),
    checkOut: date("check_out").notNull(),
    occupancies: jsonb("occupancies")
      .$type<Array<{ adults: number; childrenAges: number[] }>>()
      .notNull(),
    source: jsonb("source").$type<Record<string, unknown>>().notNull().default({}),
    note: text("note").notNull().default(""),
    attentionReason: varchar("attention_reason", { length: 40 }),
    currentOfferId: uuid("current_offer_id"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("inquiries_hotel_idempotency_unique").on(table.hotelId, table.idempotencyKey),
    index("inquiries_hotel_created_idx").on(table.hotelId, table.createdAt),
  ],
);

export const offerVersions = pgTable(
  "offer_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hotelId: uuid("hotel_id")
      .notNull()
      .references(() => hotels.id, { onDelete: "cascade" }),
    inquiryId: uuid("inquiry_id")
      .notNull()
      .references(() => inquiries.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    state: offerState("state").notNull().default("active"),
    publicTokenHash: varchar("public_token_hash", { length: 64 }).notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    selectedOptionIndex: integer("selected_option_index"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("offer_versions_inquiry_version_unique").on(table.inquiryId, table.version),
    uniqueIndex("offer_versions_public_token_unique").on(table.publicTokenHash),
    index("offer_versions_inquiry_idx").on(table.inquiryId),
  ],
);

export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hotelId: uuid("hotel_id")
      .notNull()
      .references(() => hotels.id, { onDelete: "cascade" }),
    inquiryId: uuid("inquiry_id").references(() => inquiries.id, { onDelete: "cascade" }),
    offerVersionId: uuid("offer_version_id").references(() => offerVersions.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 64 }).notNull(),
    channel: deliveryChannel("channel").notNull(),
    state: deliveryState("state").notNull().default("scheduled"),
    idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
    recipient: varchar("recipient", { length: 320 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    providerMessageId: varchar("provider_message_id", { length: 200 }),
    lastErrorCode: varchar("last_error_code", { length: 100 }),
    lastErrorMessage: text("last_error_message"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("deliveries_hotel_idempotency_unique").on(table.hotelId, table.idempotencyKey),
    index("deliveries_worker_idx").on(table.state, table.nextAttemptAt),
    index("deliveries_inquiry_idx").on(table.inquiryId),
  ],
);

export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hotelId: uuid("hotel_id")
      .notNull()
      .references(() => hotels.id, { onDelete: "cascade" }),
    kind: connectionKind("kind").notNull(),
    state: connectionState("state").notNull().default("disconnected"),
    encryptedCredentials: text("encrypted_credentials"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 100 }),
    ...timestamps,
  },
  (table) => [uniqueIndex("connections_hotel_kind_unique").on(table.hotelId, table.kind)],
);
