CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "btree_gist";--> statement-breakpoint
CREATE TYPE "public"."connection_kind" AS ENUM('google', 'waha');--> statement-breakpoint
CREATE TYPE "public"."connection_state" AS ENUM('disconnected', 'connecting', 'connected', 'attention');--> statement-breakpoint
CREATE TYPE "public"."delivery_channel" AS ENUM('email', 'whatsapp', 'push');--> statement-breakpoint
CREATE TYPE "public"."delivery_state" AS ENUM('scheduled', 'processing', 'provider_accepted', 'delivered', 'failed', 'unknown', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'staff');--> statement-breakpoint
CREATE TYPE "public"."offer_state" AS ENUM('active', 'accepted', 'expired', 'revoked');--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"kind" "connection_kind" NOT NULL,
	"state" "connection_state" DEFAULT 'disconnected' NOT NULL,
	"encrypted_credentials" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_error_code" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"inquiry_id" uuid,
	"offer_version_id" uuid,
	"kind" varchar(64) NOT NULL,
	"channel" "delivery_channel" NOT NULL,
	"state" "delivery_state" DEFAULT 'scheduled' NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"recipient" varchar(320) NOT NULL,
	"payload" jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_message_id" varchar(200),
	"last_error_code" varchar(100),
	"last_error_message" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hotel_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'staff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hotels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"timezone" varchar(64) DEFAULT 'Europe/Rome' NOT NULL,
	"email" varchar(320),
	"phone" varchar(50),
	"website" text,
	"logo_url" text,
	"photo_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"terms_text" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"guest_name" varchar(160) NOT NULL,
	"guest_email" varchar(320),
	"guest_phone" varchar(50),
	"locale" varchar(16) DEFAULT 'it' NOT NULL,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"occupancies" jsonb NOT NULL,
	"source" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_offer_id" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"inquiry_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"state" "offer_state" DEFAULT 'active' NOT NULL,
	"public_token_hash" varchar(64) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"plan_key" varchar(40) NOT NULL,
	"meal_plan" varchar(40) DEFAULT 'room_only' NOT NULL,
	"start_date" date NOT NULL,
	"end_date_exclusive" date NOT NULL,
	"nightly_price_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"included_adults" integer DEFAULT 2 NOT NULL,
	"included_children" integer DEFAULT 0 NOT NULL,
	"extra_adult_cents" integer DEFAULT 0 NOT NULL,
	"extra_child_cents" integer DEFAULT 0 NOT NULL,
	"child_max_age" integer DEFAULT 17 NOT NULL,
	"minimum_nights" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"max_adults" integer NOT NULL,
	"max_children" integer DEFAULT 0 NOT NULL,
	"beds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"amenities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"photo_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" varchar(120),
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_inquiry_id_inquiries_id_fk" FOREIGN KEY ("inquiry_id") REFERENCES "public"."inquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_offer_version_id_offer_versions_id_fk" FOREIGN KEY ("offer_version_id") REFERENCES "public"."offer_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_members" ADD CONSTRAINT "hotel_members_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_members" ADD CONSTRAINT "hotel_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_versions" ADD CONSTRAINT "offer_versions_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_versions" ADD CONSTRAINT "offer_versions_inquiry_id_inquiries_id_fk" FOREIGN KEY ("inquiry_id") REFERENCES "public"."inquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_periods" ADD CONSTRAINT "rate_periods_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_current_offer_fk" FOREIGN KEY ("current_offer_id") REFERENCES "public"."offer_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotels" ADD CONSTRAINT "hotels_currency_uppercase" CHECK ("currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_capacity_valid" CHECK ("max_adults" > 0 AND "max_children" >= 0);--> statement-breakpoint
ALTER TABLE "rate_periods" ADD CONSTRAINT "rate_periods_dates_valid" CHECK ("start_date" < "end_date_exclusive");--> statement-breakpoint
ALTER TABLE "rate_periods" ADD CONSTRAINT "rate_periods_values_valid" CHECK (
	"nightly_price_cents" >= 0 AND "included_adults" >= 0 AND "included_children" >= 0
	AND "extra_adult_cents" >= 0 AND "extra_child_cents" >= 0
	AND "child_max_age" BETWEEN 0 AND 17 AND "minimum_nights" > 0
);--> statement-breakpoint
ALTER TABLE "rate_periods" ADD CONSTRAINT "rate_periods_no_overlap" EXCLUDE USING gist (
	"room_id" WITH =,
	"plan_key" WITH =,
	daterange("start_date", "end_date_exclusive", '[)') WITH &&
) WHERE ("deleted_at" IS NULL);--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_dates_valid" CHECK ("check_in" < "check_out");--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_contact_present" CHECK ("guest_email" IS NOT NULL OR "guest_phone" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "offer_versions" ADD CONSTRAINT "offer_versions_positive_version" CHECK ("version" > 0);--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_attempts_valid" CHECK ("attempt_count" >= 0);--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_unique" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expiry_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_hotel_kind_unique" ON "connections" USING btree ("hotel_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_hotel_idempotency_unique" ON "deliveries" USING btree ("hotel_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "deliveries_worker_idx" ON "deliveries" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "deliveries_inquiry_idx" ON "deliveries" USING btree ("inquiry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hotel_members_hotel_user_unique" ON "hotel_members" USING btree ("hotel_id","user_id");--> statement-breakpoint
CREATE INDEX "hotel_members_user_idx" ON "hotel_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inquiries_hotel_idempotency_unique" ON "inquiries" USING btree ("hotel_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "inquiries_hotel_created_idx" ON "inquiries" USING btree ("hotel_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_versions_inquiry_version_unique" ON "offer_versions" USING btree ("inquiry_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_versions_public_token_unique" ON "offer_versions" USING btree ("public_token_hash");--> statement-breakpoint
CREATE INDEX "offer_versions_inquiry_idx" ON "offer_versions" USING btree ("inquiry_id");--> statement-breakpoint
CREATE INDEX "rate_periods_room_idx" ON "rate_periods" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "rooms_hotel_idx" ON "rooms" USING btree ("hotel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_unique" ON "users" USING btree (lower("email"));
