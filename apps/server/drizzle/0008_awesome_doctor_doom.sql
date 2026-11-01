ALTER TABLE "rate_periods" ADD COLUMN "breakfast_adult_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_periods" ADD COLUMN "breakfast_child_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_periods" DROP CONSTRAINT "rate_periods_values_valid";--> statement-breakpoint
ALTER TABLE "rate_periods" ADD CONSTRAINT "rate_periods_values_valid" CHECK (
	"nightly_price_cents" >= 0 AND "included_adults" >= 0 AND "included_children" >= 0
	AND "extra_adult_cents" >= 0 AND "extra_child_cents" >= 0
	AND "breakfast_adult_cents" >= 0 AND "breakfast_child_cents" >= 0
	AND "child_max_age" BETWEEN 0 AND 17 AND "minimum_nights" > 0
);
