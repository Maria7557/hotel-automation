ALTER TABLE "rate_periods" DROP CONSTRAINT "rate_periods_no_overlap";--> statement-breakpoint
ALTER TABLE "rate_periods" ADD COLUMN "plan_name" varchar(120);--> statement-breakpoint
UPDATE "rate_periods" SET "plan_name" = "plan_key";--> statement-breakpoint
ALTER TABLE "rate_periods" ALTER COLUMN "plan_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_periods" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "max_guests" integer;--> statement-breakpoint
UPDATE "rooms" SET "max_guests" = "max_adults" + "max_children";--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "max_guests" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_total_capacity_valid" CHECK (
	"max_guests" >= "max_adults" AND "max_guests" <= "max_adults" + "max_children"
);--> statement-breakpoint
ALTER TABLE "rate_periods" ADD CONSTRAINT "rate_periods_no_overlap" EXCLUDE USING gist (
	"room_id" WITH =,
	"plan_key" WITH =,
	daterange("start_date", "end_date_exclusive", '[)') WITH &&
) WHERE ("deleted_at" IS NULL AND "active" = true);
