ALTER TABLE "hotels" ADD COLUMN "city" varchar(120) NOT NULL;--> statement-breakpoint
ALTER TABLE "hotels" ADD COLUMN "country_code" varchar(2) DEFAULT 'IT' NOT NULL;--> statement-breakpoint
ALTER TABLE "hotels" ADD COLUMN "locale" varchar(16) DEFAULT 'it-IT' NOT NULL;