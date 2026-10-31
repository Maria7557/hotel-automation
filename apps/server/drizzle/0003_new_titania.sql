ALTER TABLE "hotels" ADD COLUMN "public_key" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "hotels" ADD COLUMN "allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "attention_reason" varchar(40);--> statement-breakpoint
ALTER TABLE "hotels" ADD CONSTRAINT "hotels_public_key_unique" UNIQUE("public_key");